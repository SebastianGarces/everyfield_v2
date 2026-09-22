import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { openai } from "eve/models/openai";
import { currentFixtureRun } from "./fixture-bridge";
import { presentationGuidanceMiddleware } from "./presentation-guidance";
import { evryIssuedResultReferences, evryResultState } from "./results";
import {
  evryInitialWorkingSet,
  initialSkillGuidance,
} from "./initial-working-set";
import {
  evryProcessingBudget,
  processingBudgetMiddleware,
} from "./processing-budget";

/** Eve does not expose per-tool strictness; our Zod registry owns validation. */
export const evryToolSchemaMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    tools: params.tools?.map((tool) =>
      tool.type === "function" ? { ...tool, strict: false } : tool
    ),
  }),
};

const initialSkillMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const guidance = initialSkillGuidance(evryInitialWorkingSet.get().skills);
    return guidance
      ? {
          ...params,
          prompt: [{ role: "system", content: guidance }, ...params.prompt],
        }
      : params;
  },
};

const fixtureBudgetMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const fixture = currentFixtureRun();
    return fixture
      ? {
          ...params,
          providerOptions: {
            ...params.providerOptions,
            openai: {
              ...params.providerOptions?.openai,
              serviceTier: "default",
            },
          },
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
    const generate = async () =>
      fixture?.model ? fixture.model.doGenerate(params) : doGenerate();
    const result = reservation
      ? await reservation.run(generate)
      : await generate();
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
    const stream = async () =>
      fixture?.model ? fixture.model.doStream(params) : doStream();
    const result = reservation ? await reservation.run(stream) : await stream();
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
  middleware: [
    evryToolSchemaMiddleware,
    initialSkillMiddleware,
    presentationGuidanceMiddleware(() => ({
      turnId: evryInitialWorkingSet.get().turnId,
      results: evryResultState.get(),
      issuedReferences: evryIssuedResultReferences.get(),
    })),
    processingBudgetMiddleware(evryProcessingBudget),
    fixtureBudgetMiddleware,
  ],
});
