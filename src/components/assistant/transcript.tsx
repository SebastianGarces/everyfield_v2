"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssistantMessageRecord } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

export function AssistantTranscript({
  messages,
}: {
  messages: AssistantMessageRecord[];
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "max-w-[90%] rounded-[22px] border px-4 py-3 text-sm leading-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]",
            message.role === "user"
              ? "ml-auto border-slate-200/80 bg-white text-slate-950"
              : "border-stone-200 bg-stone-50/90 text-slate-800"
          )}
        >
          <p>{message.content}</p>

          {message.role === "assistant" &&
          Array.isArray(message.metadata?.actions) &&
          message.metadata.actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.metadata.actions.map((action) => (
                <Button
                  key={`${message.id}-${action.href}`}
                  asChild
                  size="sm"
                  variant="secondary"
                  className="cursor-pointer rounded-full"
                >
                  <a
                    href={action.href}
                    target={action.target ?? "_self"}
                    rel={
                      action.target === "_blank"
                        ? "noreferrer noopener"
                        : undefined
                    }
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {action.label}
                  </a>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
