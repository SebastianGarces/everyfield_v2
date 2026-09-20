import { defineAgent } from "eve";
import { evryLunaModel } from "../src/lib/evry/eve/runtime/model";

export default defineAgent({
  model: evryLunaModel,
  reasoning: "medium",
  defaultTools: false,
  tool: false,
  limits: {
    maxInputTokensPerSession: 300_000,
    maxOutputTokensPerSession: 30_000,
  },
  build: { externalDependencies: ["@neondatabase/serverless"] },
});
