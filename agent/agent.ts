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
  // PDF.js loads its worker and native helpers relative to its package URL.
  // Inlining it relocates those lookups to the Eve server entry.
  build: { externalDependencies: ["@neondatabase/serverless", "pdfjs-dist"] },
});
