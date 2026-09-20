"use client";

import { Button } from "@/components/ui/button";
import { useEvryShell } from "../evry-shell";

export function EveQuestionOptions({ requestId }: { requestId: string }) {
  const { messages, isWorking, respondToQuestion } = useEvryShell();
  const request = messages
    .flatMap((message) => message.parts)
    .find(
      (part) =>
        part.type === "dynamic-tool" &&
        part.state === "approval-requested" &&
        part.toolMetadata?.eve?.inputRequest?.requestId === requestId
    );
  const options =
    request?.type === "dynamic-tool"
      ? request.toolMetadata?.eve?.inputRequest?.options
      : undefined;
  if (!options?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Choose an answer">
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="outline"
          className="h-auto min-h-11 text-left whitespace-normal"
          disabled={isWorking}
          onClick={() => void respondToQuestion(requestId, "", option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
