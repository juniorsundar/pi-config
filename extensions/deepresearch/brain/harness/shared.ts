import type { ResearchBrain } from "./types";
import { OllamaBrain } from "./ollama-brain";
import { loadDeepresearchConfig } from "./config";

/** Factory type for creating a ResearchBrain. Injectable for testing. */
export type BrainFactory = () => Promise<ResearchBrain>;

export const defaultBrainFactory: BrainFactory = async () => {
  const config = await loadDeepresearchConfig();
  return new OllamaBrain({
    model: config.model,
    host: config.ollamaHost,
    systemPrompt: config.systemPrompt,
    options: config.options,
  });
};
