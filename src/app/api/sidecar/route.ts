import { NextRequest, NextResponse } from "next/server";
import { OpenAPISidecar } from "openapi-sidecar";

export async function POST(req: NextRequest) {
  const { question } = (await req.json()) as { question?: string };

  if (!question || typeof question !== "string") {
    return NextResponse.json(
      { error: "Missing required field: question" },
      { status: 400 }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const sidecar = new OpenAPISidecar({
    spec: `${baseUrl}/api/v1/doc`,
    baseUrl,
    debug: process.env.NODE_ENV === "development",
    auth: {},
    llm: {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey,
      model:
        process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
    },
  });

  try {
    const result = await sidecar.query(question);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sidecar]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sidecar query failed" },
      { status: 500 }
    );
  }
}
