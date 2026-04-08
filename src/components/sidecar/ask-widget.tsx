"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { querySidecar } from "@/lib/sidecar/query";
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

export function AskWidget() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [meta, setMeta] = useState<{
    iterations: number;
    endpoints_called: string[];
    tokens: { prompt: number; completion: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || isPending) return;

    setError(null);
    setAnswer(null);
    setData(null);
    setMeta(null);

    startTransition(async () => {
      try {
        const result = await querySidecar(question.trim());
        setAnswer(result.answer);
        setData(result.data);
        setMeta(result.meta);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <div className="bg-card rounded-xl border p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="text-violet-500 h-5 w-5" />
        <h2 className="text-lg font-semibold">Ask EveryField</h2>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Ask a natural language question about your data
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How many people are in my pipeline?"
          disabled={isPending}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={isPending || !question.trim()}
          className="cursor-pointer"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Ask"
          )}
        </Button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {answer && (
        <div className="mt-4 space-y-3">
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {answer}
            </p>
          </div>

          {(data || meta) && (
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs transition-colors"
            >
              {showDetails ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {showDetails ? "Hide" : "Show"} details
            </button>
          )}

          {showDetails && (
            <div className="space-y-2">
              {meta && (
                <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
                  <span>{meta.iterations} iteration(s)</span>
                  <span>
                    {meta.tokens.prompt + meta.tokens.completion} tokens
                  </span>
                  {meta.endpoints_called.length > 0 && (
                    <span>
                      Endpoints: {meta.endpoints_called.join(", ")}
                    </span>
                  )}
                </div>
              )}
              {data != null && (
                <pre className="bg-muted max-h-64 overflow-auto rounded-lg p-3 text-xs">
                  {JSON.stringify(data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
