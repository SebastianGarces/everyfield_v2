"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const starterPrompts = [
  "Schedule a vision meeting next Tuesday at 7 PM",
  "Create an orientation for new people next Sunday",
  "Set up a team meeting for the worship team",
  "Draft a follow-up email for last night's guests",
];

export function AssistantEmptyState({
  onPromptSelect,
}: {
  onPromptSelect: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-8 px-4 py-10 text-center">
      <div className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium">
        <Sparkles className="h-4 w-4" />
        AI Assistant
      </div>

      <div className="space-y-3">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Stay in one conversation while the work takes shape beside it.
        </h2>
        <p className="text-muted-foreground mx-auto max-w-2xl text-base leading-7">
          This page will become the place to plan meetings, invite people, and
          handle follow-up without bouncing around the app. Start with one of
          these prompts or ask for what you need directly.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {starterPrompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            className="cursor-pointer rounded-full"
            onClick={() => onPromptSelect(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}
