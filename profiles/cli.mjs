import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const agentDir = dirname(dirname(fileURLToPath(import.meta.url)));
const instructions = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
];
const sharedDirectories = ["git", "npm", "sessions", "cache"];
const sharedFiles = [
  "auth.json",
  "trust.json",
  "mcp-auth.json",
  "models-store.json",
  "mcp-cache.json",
  "mcp-onboarding.json",
  "settings.json",
  "mcp.json",
];
const reserved = new Set(["profiles", "git", "npm", "bin", "install"]);

function settings(path) {
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid settings: ${path}`);
  return value;
}

function packageSource(pkg) {
  if (typeof pkg === "string") return pkg;
  if (pkg && typeof pkg.source === "string") return pkg.source;
  throw new Error("Invalid package declaration in settings.json");
}

function gitInstallPath(base, source) {
  const spec = source.startsWith("git:") ? source.slice(4) : source;
  const ssh = spec.match(/^git@([^:]+):(.+)$/);
  let host, path;
  if (ssh) {
    [, host, path] = ssh;
  } else if (spec.includes("://")) {
    const url = new URL(spec);
    host = url.hostname;
    path = url.pathname.slice(1);
  } else {
    const slash = spec.indexOf("/");
    host = spec.slice(0, slash);
    path = spec.slice(slash + 1);
  }
  path = path.split("@")[0].replace(/\.git$/, "");
  const installed = resolve(base, "git", host, path);
  if (!host || !path || !installed.startsWith(resolve(base, "git") + sep)) {
    throw new Error(`Invalid git package: ${source}`);
  }
  return installed;
}

export function checkPackages(base, selected, effectiveDir) {
  const globalPackages = new Set(
    (settings(join(base, "settings.json")).packages ?? []).map(packageSource),
  );
  const packages = (
    settings(join(selected, "settings.json")).packages ?? []
  ).map(packageSource);
  for (const source of packages) {
    if (!globalPackages.has(source))
      throw new Error(
        `Package ${source} is not installed by plain Pi (or uses a conflicting version/ref)`,
      );
  }
  // Without a profile settings.json, Pi still loads global packages. Check them too.
  for (const source of existsSync(join(selected, "settings.json"))
    ? packages
    : globalPackages) {
    if (source.startsWith("npm:")) {
      const match = source.slice(4).match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
      if (!match) throw new Error(`Invalid npm package: ${source}`);
      const installed = join(
        base,
        "npm",
        "node_modules",
        match[1],
        "package.json",
      );
      if (!existsSync(installed))
        throw new Error(
          `Package ${source} is missing from shared npm/; install it with plain Pi`,
        );
      if (match[2]) {
        const release = readFileSync(
          join(base, "install", "current-version"),
          "utf8",
        ).trim();
        const require = createRequire(
          join(
            base,
            "install",
            "releases",
            release,
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
            "package.json",
          ),
        );
        const semver = require("semver");
        const version = JSON.parse(readFileSync(installed, "utf8")).version;
        if (
          semver.validRange(match[2]) &&
          !semver.satisfies(version, match[2])
        ) {
          throw new Error(
            `Package ${source} has installed version ${version}; update it with plain Pi`,
          );
        }
      }
    } else if (source.startsWith("git:") || /^(https?|ssh):\/\//.test(source)) {
      if (!existsSync(gitInstallPath(base, source))) {
        throw new Error(
          `Package ${source} is missing from shared git/; install it with plain Pi`,
        );
      }
    } else if (!existsSync(resolve(effectiveDir, source))) {
      throw new Error(`Local package ${source} is missing`);
    }
  }
}

export function prepareOverlay(base, name, cacheDir) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(`Invalid profile name: ${name}`);
  }
  const profile = join(base, "profiles", name);
  if (!existsSync(profile) || !lstatSync(profile).isDirectory())
    throw new Error(`Profile does not exist: ${profile}`);
  const entries = new Set(readdirSync(profile));
  for (const entry of reserved) {
    if (entries.has(entry))
      throw new Error(`Profile cannot override ${entry}/`);
  }
  for (const dir of sharedDirectories)
    mkdirSync(join(base, dir), { recursive: true });
  const overlay = join(cacheDir, name);
  mkdirSync(overlay, { recursive: true, mode: 0o700 });
  if (!lstatSync(overlay).isDirectory())
    throw new Error(`Overlay is not a directory: ${overlay}`);
  const names = new Set([
    ...readdirSync(base),
    ...entries,
    ...sharedFiles,
    ...sharedDirectories,
  ]);
  names.delete("profiles");
  // An explicit profile instruction file replaces all global instruction aliases.
  if (instructions.some((file) => entries.has(file))) {
    for (const file of instructions) if (!entries.has(file)) names.delete(file);
  }
  for (const name of readdirSync(overlay)) {
    if (names.has(name)) continue;
    const path = join(overlay, name);
    if (!lstatSync(path).isSymbolicLink())
      throw new Error(`Refusing to remove non-link in overlay: ${path}`);
    unlinkSync(path);
  }
  for (const name of names) {
    const path = join(overlay, name);
    const target = join(entries.has(name) ? profile : base, name);
    const current = readlinkIfLink(path);
    if (current === target) continue;
    if (current === undefined && existsSync(path))
      throw new Error(`Refusing to replace non-link in overlay: ${path}`);
    const temporary = join(overlay, `.${name}.${process.pid}.tmp`);
    try {
      symlinkSync(target, temporary);
      renameSync(temporary, path);
    } finally {
      if (readlinkIfLink(temporary) !== undefined) unlinkSync(temporary);
    }
  }
  checkPackages(base, profile, overlay);
  return overlay;
}

function readlinkIfLink(path) {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function main(
  args,
  base = agentDir,
  cacheDir = join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "pi-profiles",
  ),
) {
  if (args[0] === "list" && args.length === 1) {
    for (const entry of readdirSync(join(base, "profiles"), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) console.log(entry.name);
    }
    return 0;
  }
  if (args[0] !== "run" || args.length < 2) {
    console.error(
      "Usage: pi profiles list | pi profiles run <name> [pi arguments...]",
    );
    return 2;
  }
  const piArgs = args.slice(2);
  if (["install", "remove", "uninstall", "update"].includes(piArgs[0])) {
    throw new Error("Manage shared packages with plain Pi, not a profile");
  }
  const overlay = prepareOverlay(base, args[1], cacheDir);
  const result = spawnSync(join(base, "bin", "pi"), piArgs, {
    stdio: "inherit",
    env: { ...process.env, PI_CODING_AGENT_DIR: overlay },
  });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`pi profiles: ${error.message}`);
    process.exitCode = 1;
  }
}
