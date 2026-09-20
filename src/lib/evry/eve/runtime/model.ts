import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { openai } from "eve/models/openai";
import { currentFixtureRun } from "./fixture-bridge";

/** Eve does not expose per-tool strictness; our Zod registry owns validation. */
export const evryToolSchemaMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    tools: params.tools?.map((tool) =>
      tool.type === "function" ? { ...tool, strict: false } : tool
    ),
  }),
};

const fixtureBudgetMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const fixture = currentFixtureRun();
    return fixture
      ? {
          ...params,
          maxOutputTokens: Math.min(
            params.maxOutputTokens ?? fixture.maxOutputTokens,
            fixture.maxOutputTokens
          ),
        }
      : params;
  },
  wrapGenerate: async ({ doGenerate, params }) => {
    const fixture = currentFixtureRun();
    const reservation = fixture?.reserve(params);
    const result = fixture?.model
      ? await fixture.model.doGenerate(params)
      : await doGenerate();
    if (reservation)
      reservation.finish(
        result.usage.inputTokens.total ?? NaN,
        result.usage.outputTokens.total ?? NaN
      );
    return result;
  },
  wrapStream: async ({ doStream, params }) => {
    const fixture = currentFixtureRun();
    const reservation = fixture?.reserve(params);
    const result = fixture?.model
      ? await fixture.model.doStream(params)
      : await doStream();
    if (!reservation) return result;
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === "finish")
              reservation.finish(
                part.usage.inputTokens.total ?? NaN,
                part.usage.outputTokens.total ?? NaN
              );
            controller.enqueue(part);
          },
        })
      ),
    };
  },
};

const directLuna = openai("gpt-5.6-luna");
if (typeof directLuna === "string")
  throw new Error(
    "Evry requires the direct OpenAI provider, not a gateway model id"
  );
export const evryLunaModel = wrapLanguageModel({
  model: directLuna,
  middleware: [evryToolSchemaMiddleware, fixtureBudgetMiddleware],
});
