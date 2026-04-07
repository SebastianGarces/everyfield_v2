export function getAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-nano";

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  return { apiKey, model };
}
