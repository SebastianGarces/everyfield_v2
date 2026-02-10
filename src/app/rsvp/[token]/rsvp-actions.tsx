"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RsvpActionsProps {
  token: string;
  /** If set to "decline", auto-trigger decline flow */
  autoAction?: string;
}

export function RsvpActions({ token, autoAction }: RsvpActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didAutoAction = useRef(false);

  const handleResponse = async (response: "confirmed" | "declined") => {
    setLoading(response === "confirmed" ? "confirm" : "decline");
    setError(null);

    try {
      const res = await fetch(`/api/rsvp/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error ?? "Something went wrong");
        setLoading(null);
        return;
      }

      // Refresh the page to show the updated state
      router.refresh();
    } catch {
      setError("Failed to submit response. Please try again.");
      setLoading(null);
    }
  };

  // Auto-decline if the URL had ?action=decline (guard against strict mode double-fire)
  useEffect(() => {
    if (autoAction === "decline" && !didAutoAction.current) {
      didAutoAction.current = true;
      handleResponse("declined");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Button
          className="flex-1 cursor-pointer"
          size="lg"
          onClick={() => handleResponse("confirmed")}
          disabled={loading !== null}
        >
          {loading === "confirm" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Confirm Attendance
        </Button>
        <Button
          variant="outline"
          className="flex-1 cursor-pointer"
          size="lg"
          onClick={() => handleResponse("declined")}
          disabled={loading !== null}
        >
          {loading === "decline" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <X className="mr-2 h-4 w-4" />
          )}
          {"Can't Make It"}
        </Button>
      </div>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
