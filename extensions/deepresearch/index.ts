import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResearchCommand } from "./entrypoints/command";
import { registerDeepresearchTool } from "./entrypoints/tool";

/**
 * Pi-native Research Orchestrator extension entry point.
 *
 * Keeps startup composition thin: human command surface and high-level agent
 * tool are registered from dedicated entrypoint modules.
 */
export default function deepresearchEntryPoint(pi: ExtensionAPI): void {
  registerResearchCommand(pi);
  registerDeepresearchTool(pi);
}
