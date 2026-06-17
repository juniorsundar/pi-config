import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadBtwTimeout } from "./timeout-config.js";

export default function btwExtension(pi: ExtensionAPI) {
  // BTW Child Guard: skip registration when running as a BTW child process
  if (process.env.PI_BTW_CHILD) return;

  pi.registerCommand("btw", {
    description: "Ask a side-question or review BTW results",
    handler: async (args: string, ctx) => {
      // Load timeout from settings (available for future BTW Process spawn)
      const timeoutResult = loadBtwTimeout();
      
      if (!args.trim()) {
        // No-args: placeholder for BTW Review (issue 0025/0028)
        await ctx.ui.notify("BTW Review is not yet implemented.");
        return;
      }
      // With question: placeholder for async query (issue 0027)
      await ctx.ui.notify("BTW query is not yet implemented.");
    },
  });
}
