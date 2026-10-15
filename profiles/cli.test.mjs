import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { checkPackages, main, prepareOverlay } from "./cli.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-profiles-test-"));
  roots.push(root);
  const base = join(root, "agent");
  const profile = join(base, "profiles", "coding");
  const cache = join(root, "cache");
  mkdirSync(profile, { recursive: true });
  mkdirSync(join(base, "skills"));
  writeFileSync(join(base, "settings.json"), JSON.stringify({ packages: [] }));
  writeFileSync(join(base, "mcp.json"), "global-mcp");
  writeFileSync(join(base, "AGENTS.override.md"), "global-instructions");
  return { root, base, profile, cache };
}

test("profile entries replace complete files and directories; missing entries inherit global", () => {
  const { base, profile, cache } = fixture();
  mkdirSync(join(profile, "skills")); // Empty still masks global skills.
  writeFileSync(join(base, "skills", "global.md"), "global");
  writeFileSync(join(profile, "AGENTS.md"), "profile-instructions");
  const overlay = prepareOverlay(base, "coding", cache);
  assert.equal(
    readlinkSync(join(overlay, "settings.json")),
    join(base, "settings.json"),
  );
  assert.equal(readlinkSync(join(overlay, "mcp.json")), join(base, "mcp.json"));
  assert.equal(readlinkSync(join(overlay, "skills")), join(profile, "skills"));
  assert.equal(existsSync(join(overlay, "skills", "global.md")), false);
  assert.equal(
    readlinkSync(join(overlay, "AGENTS.md")),
    join(profile, "AGENTS.md"),
  );
  assert.equal(existsSync(join(overlay, "AGENTS.override.md")), false);
  assert.equal(readlinkSync(join(overlay, "npm")), join(base, "npm"));
  assert.equal(readlinkSync(join(overlay, "git")), join(base, "git"));
  assert.equal(existsSync(join(overlay, "profiles")), false);
  writeFileSync(join(profile, "mcp.json"), "profile-mcp");
  assert.equal(prepareOverlay(base, "coding", cache), overlay);
  assert.equal(readFileSync(join(overlay, "mcp.json"), "utf8"), "profile-mcp");
  rmSync(join(profile, "mcp.json"));
  prepareOverlay(base, "coding", cache);
  assert.equal(readFileSync(join(overlay, "mcp.json"), "utf8"), "global-mcp");
});

test("a profile selects only already-installed shared packages", () => {
  const { base, profile, cache } = fixture();
  writeFileSync(
    join(base, "settings.json"),
    JSON.stringify({
      packages: ["npm:@example/one", "git:github.com/example/two"],
    }),
  );
  mkdirSync(join(base, "npm", "node_modules", "@example", "one"), {
    recursive: true,
  });
  writeFileSync(
    join(base, "npm", "node_modules", "@example", "one", "package.json"),
    '{"version":"1.0.0"}',
  );
  mkdirSync(join(base, "git", "github.com", "example", "two"), {
    recursive: true,
  });
  writeFileSync(
    join(profile, "settings.json"),
    JSON.stringify({ packages: ["npm:@example/one"] }),
  );
  const overlay = prepareOverlay(base, "coding", cache);
  assert.equal(
    readlinkSync(join(overlay, "settings.json")),
    join(profile, "settings.json"),
  );
  writeFileSync(
    join(profile, "settings.json"),
    JSON.stringify({ packages: ["npm:@example/other"] }),
  );
  assert.throws(
    () => checkPackages(base, profile, overlay),
    /not installed by plain Pi/,
  );
  writeFileSync(
    join(profile, "settings.json"),
    JSON.stringify({ packages: ["git:github.com/example/two@other"] }),
  );
  assert.throws(
    () => checkPackages(base, profile, overlay),
    /conflicting version\/ref/,
  );
  writeFileSync(
    join(profile, "settings.json"),
    JSON.stringify({ packages: ["git:github.com/example/two"] }),
  );
  rmSync(join(base, "git", "github.com", "example", "two"), {
    recursive: true,
  });
  assert.throws(
    () => checkPackages(base, profile, overlay),
    /missing from shared git/,
  );
});

test("git SSH and HTTPS sources reuse their installed checkout", () => {
  const { base, profile, cache } = fixture();
  const sources = [
    "git:git@github.com:example/tool@v1",
    "https://github.com/example/tool.git@v1",
  ];
  mkdirSync(join(base, "git", "github.com", "example", "tool"), {
    recursive: true,
  });
  for (const source of sources) {
    writeFileSync(
      join(base, "settings.json"),
      JSON.stringify({ packages: [source] }),
    );
    writeFileSync(
      join(profile, "settings.json"),
      JSON.stringify({ packages: [source] }),
    );
    assert.doesNotThrow(() => prepareOverlay(base, "coding", cache));
  }
});

test("reject traversal, unknown profiles, and non-link overlay content", () => {
  const { base, cache } = fixture();
  assert.throws(
    () => prepareOverlay(base, "../coding", cache),
    /Invalid profile name/,
  );
  assert.throws(() => prepareOverlay(base, "unknown", cache), /does not exist/);
  const overlay = prepareOverlay(base, "coding", cache);
  rmSync(join(overlay, "mcp.json"));
  writeFileSync(join(overlay, "mcp.json"), "do-not-delete");
  assert.throws(
    () => prepareOverlay(base, "coding", cache),
    /Refusing to replace non-link/,
  );
  assert.equal(
    readFileSync(join(overlay, "mcp.json"), "utf8"),
    "do-not-delete",
  );
});

test("run forwards args and selected dir; package commands are blocked", () => {
  const { root, base, cache } = fixture();
  mkdirSync(join(base, "bin"));
  const fakePi = join(base, "bin", "pi");
  writeFileSync(
    fakePi,
    `#!/bin/sh\nprintf '%s\\n' "$PI_CODING_AGENT_DIR" "$@" > '${join(root, "capture")}'\nexit 7\n`,
    { mode: 0o755 },
  );
  assert.equal(main(["run", "coding", "--version"], base, cache), 7);
  assert.deepEqual(
    readFileSync(join(root, "capture"), "utf8").trim().split("\n"),
    [join(cache, "coding"), "--version"],
  );
  assert.throws(
    () => main(["run", "coding", "install", "npm:bad"], base, cache),
    /Manage shared packages/,
  );
  assert.equal(main(["run", "coding", "--help"], base, cache), 7);
  assert.equal(lstatSync(join(cache, "coding")).isDirectory(), true);
});

test("bootstrap redirects only the expected launcher symlink", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-bootstrap-test-"));
  roots.push(home);
  const bin = join(home, ".local", "bin");
  const base = join(home, "agent");
  const profiles = join(base, "profiles");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(base, "bin"), { recursive: true });
  mkdirSync(profiles);
  const link = join(bin, "pi");
  const managed = join(base, "bin", "pi");
  const shim = join(profiles, "pi");
  const script = join(profiles, "bootstrap.sh");
  writeFileSync(managed, "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(shim, "#!/bin/sh\n", { mode: 0o755 });
  copyFileSync(new URL("./bootstrap.sh", import.meta.url), script);
  const run = () =>
    spawnSync("sh", [script], { env: { ...process.env, HOME: home } });
  symlinkSync(managed, link);
  assert.equal(run().status, 0);
  assert.equal(readlinkSync(link), shim);
  assert.equal(run().status, 0); // Idempotent.
  unlinkSync(link);
  symlinkSync("../../agent/bin/pi", link);
  assert.equal(run().status, 0); // Installer-style relative link.
  assert.equal(readlinkSync(link), shim);
  unlinkSync(link);
  symlinkSync("/bin/sh", link);
  assert.equal(run().status, 1);
  assert.equal(readlinkSync(link), "/bin/sh");
  unlinkSync(link);
  writeFileSync(link, "do-not-delete");
  assert.equal(run().status, 1);
  assert.equal(readFileSync(link, "utf8"), "do-not-delete");
});

test("child termination is reported as a signal", () => {
  const { base, cache } = fixture();
  mkdirSync(join(base, "bin"));
  writeFileSync(join(base, "bin", "pi"), "#!/bin/sh\nkill -TERM $$\n", {
    mode: 0o755,
  });
  const script = `import { main } from ${JSON.stringify(new URL("./cli.mjs", import.meta.url).href)}; main(["run", "coding"], ${JSON.stringify(base)}, ${JSON.stringify(cache)});`;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    script,
  ]);
  assert.equal(result.signal, "SIGTERM");
});
