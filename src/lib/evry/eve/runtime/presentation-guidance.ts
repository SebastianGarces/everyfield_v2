import type { LanguageModelMiddleware } from "ai";
import type { evryResultState } from "./results";

type Prompt = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"]["prompt"];
type ToolOutput = Extract<
  Extract<Prompt[number], { role: "tool" }>["content"][number],
  { type: "tool-result" }
>["output"];
type Json = Extract<ToolOutput, { type: "json" }>["value"];
type PresentationState = {
  turnId: string | null;
  results: readonly Pick<
    ReturnType<typeof evryResultState.get>[number],
    "turnId" | "reference" | "capability"
  >[];
  issuedReferences: readonly string[];
};

function replaceJson(value: Json, replace: (text: string) => string): Json {
  if (typeof value === "string") return replace(value);
  if (Array.isArray(value))
    return value.map((item) => replaceJson(item, replace));
  if (value && typeof value === "object") {
    const used = new Set(Object.keys(value));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const replacement = replace(key);
        let nextKey = replacement;
        if (replacement !== key) {
          let suffix = 1;
          while (used.has(nextKey)) nextKey = `${replacement} ${suffix++}`;
          used.add(nextKey);
        }
        return [
          nextKey,
          item === undefined ? item : replaceJson(item, replace),
        ];
      })
    );
  }
  return value;
}

/** Retire only issued opaque handles; never infer identity from a UUID pattern. */
export function projectPresentationHistory(
  prompt: Prompt,
  state: PresentationState
): Prompt {
  const current = new Set(
    state.results
      .filter(
        (result) =>
          state.turnId !== null &&
          result.turnId === state.turnId &&
          result.capability !== "actions.prepare"
      )
      .map((result) => result.reference)
  );
  const known = new Set([
    ...state.issuedReferences,
    ...state.results
      .filter((result) => result.capability !== "actions.prepare")
      .map((result) => result.reference),
  ]);
  const obsolete = [...known].filter((reference) => !current.has(reference));
  if (obsolete.length === 0) return prompt;
  const escape = (reference: string) =>
    reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const spellings = [
    ...new Set(
      obsolete.flatMap((reference) => [
        escape(reference),
        escape(encodeURIComponent(reference)).replace(/%[\dA-F]{2}/g, (hex) =>
          hex.replace(
            /[A-F]/g,
            (letter) => `[${letter}${letter.toLowerCase()}]`
          )
        ),
      ])
    ),
  ];
  const escaped = spellings.sort((a, b) => b.length - a.length).join("|");
  const retired = new Set(obsolete);
  const markers = /\[\[evry-result:([^\]\r\n]+)\]\]/g;
  const handles = new RegExp(
    `(?<![\\w:%.-])(?:${escaped})(?![\\w:%-]|\\.[\\w:%.-])`,
    "g"
  );
  const replace = (text: string) =>
    text
      .replace(markers, (marker, encoded: string) => {
        try {
          return retired.has(decodeURIComponent(encoded))
            ? "[Earlier result card omitted]"
            : marker;
        } catch {
          return marker;
        }
      })
      .replace(handles, "[retired card reference]");
  const output = (value: ToolOutput): ToolOutput => {
    switch (value.type) {
      case "json":
      case "error-json":
        return { ...value, value: replaceJson(value.value, replace) };
      case "text":
      case "error-text":
        return { ...value, value: replace(value.value) };
      case "content":
        return {
          ...value,
          value: value.value.map((part) =>
            part.type === "text" ? { ...part, text: replace(part.text) } : part
          ),
        };
      case "execution-denied":
        return value;
    }
  };
  return prompt.map((message) => {
    if (message.role === "user" || message.role === "system") return message;
    if (message.role === "tool")
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "tool-result" && part.toolName !== "actions_prepare"
            ? { ...part, output: output(part.output) }
            : part
        ),
      };
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "text" || part.type === "reasoning")
          return { ...part, text: replace(part.text) };
        if (
          part.type === "tool-call" &&
          part.toolName === "code_mode" &&
          part.input &&
          typeof part.input === "object" &&
          "js" in part.input &&
          typeof part.input.js === "string"
        )
          return {
            ...part,
            input: { ...part.input, js: replace(part.input.js) },
          };
        if (part.type === "tool-result" && part.toolName !== "actions_prepare")
          return { ...part, output: output(part.output) };
        return part;
      }),
    };
  });
}

/** Provider-only view. Persisted history, native envelopes and tool authority stay intact. */
export function presentationGuidanceMiddleware(
  readState: () => PresentationState
): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => ({
      ...params,
      prompt: projectPresentationHistory(params.prompt, readState()),
    }),
  };
}
