"use client";

import { type FormEvent, type KeyboardEvent } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AssistantChatComposer({
  value,
  onChange,
  onSend,
  isSending,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onSend();
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message the assistant"
        className="min-h-24 resize-none border-0 bg-white px-5 py-4 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex items-center justify-end gap-3">
        <Button
          type="submit"
          className="cursor-pointer rounded-full px-4"
          disabled={isSending || !value.trim()}
        >
          {isSending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Send
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
