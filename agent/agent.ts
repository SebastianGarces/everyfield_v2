import { defineAgent } from "eve";
import { evryLunaModel } from "../src/lib/evry/eve/runtime/model";

export default defineAgent({
  model: evryLunaModel,
  reasoning: "medium",
  defaultTools: false,
  tool: false,
  limits: {
    maxInputTokensPerSession: 40_000_000,
    maxOutputTokensPerSession: 1_000_000,
  },
  build: { externalDependencies: ["@neondatabase/serverless"] },
});
