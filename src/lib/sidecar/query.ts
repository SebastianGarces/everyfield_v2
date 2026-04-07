"use server";

import { OpenAPISidecar } from "openapi-sidecar";
import type { QueryResult } from "openapi-sidecar";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function createSidecar() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  return new OpenAPISidecar({
    spec: `${BASE_URL}/api/v1/doc`,
    baseUrl: BASE_URL,
    debug: process.env.NODE_ENV === "development",
    auth: {},
    llm: {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey,
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
    },
  });
}

export async function querySidecar(
  question: string
): Promise<QueryResult> {
  const sidecar = createSidecar();
  return sidecar.query(question);
}
