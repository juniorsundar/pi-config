import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerBashApproval from "./bash-approval";
import registerDiffApproval from "./diff-approval";
import registerPermissionProfile from "./permission-profile";
import { registerMutationVerdictRenderer } from "./verdict";

/**
 * Mutation Package — canonical owner of mutation-related approval behavior.
 *
 * Registers permission profile state/commands, Bash Approval, and
 * edit/write diff approval. The shared mutation-verdict renderer is
 * registered here so both approval flows surface verdicts consistently.
 */
export default function registerMutationPackage(pi: ExtensionAPI) {
  registerMutationVerdictRenderer(pi);
  registerPermissionProfile(pi);
  registerDiffApproval(pi);
  registerBashApproval(pi);
}
