import { defineAgent } from "eve";
import { openai } from "eve/models/openai";

export default defineAgent({
  model: openai("gpt-5.6-luna"),
  reasoning: "medium",
  defaultTools: false,
  tool: false,
  limits: {
    maxInputTokensPerSession: 300_000,
    maxOutputTokensPerSession: 30_000,
  },
  build: { externalDependencies: ["@neondatabase/serverless"] },
});
