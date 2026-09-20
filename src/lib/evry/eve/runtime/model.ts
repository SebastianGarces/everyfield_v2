import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { openai } from "eve/models/openai";

/** Eve does not expose per-tool strictness; our Zod registry owns validation. */
export const evryToolSchemaMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    tools: params.tools?.map((tool) =>
      tool.type === "function" ? { ...tool, strict: false } : tool
    ),
  }),
};

const directLuna = openai("gpt-5.6-luna");
if (typeof directLuna === "string")
  throw new Error(
    "Evry requires the direct OpenAI provider, not a gateway model id"
  );
export const evryLunaModel = wrapLanguageModel({
  model: directLuna,
  middleware: evryToolSchemaMiddleware,
});
