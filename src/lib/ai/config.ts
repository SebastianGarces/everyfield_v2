export function getAiConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-nano";

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  return { apiKey, model };
}
