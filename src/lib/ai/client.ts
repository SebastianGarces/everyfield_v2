import { getAiConfig } from "./config";

export class AiRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRefusalError";
  }
}

export class AiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiParseError";
  }
}

type GenerateStructuredObjectInput = {
  system: string;
  prompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
};

type OpenAIResponsesApiOutput = {
  output?: Array<{
    type: string;
    content?: Array<
      | {
          type: "refusal";
          refusal: string;
        }
      | {
          type: "output_text";
          text: string;
        }
      | {
          type: string;
          [key: string]: unknown;
        }
    >;
  }>;
  error?: {
    message?: string;
  } | null;
};

export async function generateStructuredObject<T>(
  input: GenerateStructuredObjectInput
): Promise<T> {
  const { apiKey, model } = getAiConfig();

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: input.system,
        },
        {
          role: "user",
          content: input.prompt,
        },
      ],
      temperature: input.temperature ?? 0.1,
      max_output_tokens: input.maxOutputTokens ?? 800,
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.jsonSchema,
        },
      },
    }),
  });

  const payload = (await response.json()) as OpenAIResponsesApiOutput;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "OpenAI request failed");
  }

  for (const output of payload.output ?? []) {
    if (output.type !== "message") {
      continue;
    }

    for (const item of output.content ?? []) {
      if (item.type === "refusal") {
        if (typeof item.refusal !== "string") {
          throw new AiParseError("Model returned an invalid refusal payload");
        }

        throw new AiRefusalError(item.refusal);
      }

      if (item.type === "output_text") {
        if (typeof item.text !== "string") {
          throw new AiParseError("Model returned non-text structured output");
        }

        try {
          return JSON.parse(item.text) as T;
        } catch {
          throw new AiParseError("Model returned invalid JSON");
        }
      }
    }
  }

  throw new AiParseError("Model returned no structured output");
}
