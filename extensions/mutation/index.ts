import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerBashApproval from "./bash-approval";
import registerDiffApproval from "./diff-approval";
import registerPermissionProfile from "./permission-profile";

/**
 * Mutation Package — canonical owner of mutation-related approval behavior.
 *
 * Registers permission profile state/commands, Bash Approval, and
 * edit/write diff approval.
 */
export default function registerMutationPackage(pi: ExtensionAPI) {
  registerPermissionProfile(pi);
  registerDiffApproval(pi);
  registerBashApproval(pi);
}
