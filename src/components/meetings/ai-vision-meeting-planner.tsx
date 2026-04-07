"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  initialVisionMeetingDraft,
  serializeDraftForCreate,
  type PlannerMessage,
  type PlannerResponse,
  type VisionMeetingDraft,
} from "@/lib/ai/vision-meeting-planner-schema";

function createAssistantMessage(content: string): PlannerMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
  };
}

function createInitialMessages(): PlannerMessage[] {
  return [
    createAssistantMessage(
      "Tell me the date, time, and location for the vision meeting you want to schedule."
    ),
  ];
}

function renderValue(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return <span className="text-muted-foreground">Not set</span>;
  }

  return <span>{value}</span>;
}

function buildCreateConfirmationMessage(params: {
  datetimeLabel?: string;
  locationLabel?: string;
  estimatedAttendance: number | null;
  notes: string | null;
}) {
  const lines = [
    "Create this vision meeting?",
    "",
    `Date & Time: ${params.datetimeLabel ?? "Not set"}`,
    `Location: ${params.locationLabel ?? "Not set"}`,
    `Estimated Attendance: ${params.estimatedAttendance ?? "Not set"}`,
    `Notes: ${params.notes?.trim() || "Not set"}`,
  ];

  return lines.join("\n");
}

export function AiVisionMeetingPlanner() {
  const router = useRouter();
  const [messages, setMessages] = useState<PlannerMessage[]>(() =>
    createInitialMessages()
  );
  const [draft, setDraft] = useState<VisionMeetingDraft>(
    initialVisionMeetingDraft
  );
  const [missingFields, setMissingFields] = useState<
    Array<"datetime" | "location">
  >(["datetime", "location"]);
  const [readyToCreate, setReadyToCreate] = useState(false);
  const [input, setInput] = useState("");
  const [isPlanning, setIsPlanning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [interpretation, setInterpretation] = useState<NonNullable<
    PlannerResponse["interpretation"]
  > | null>(null);

  async function handleSendMessage() {
    if (!input.trim() || isPlanning) {
      return;
    }

    const userMessage: PlannerMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setIsPlanning(true);

    try {
      const response = await fetch("/api/v1/ai/planner", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages,
          draft,
        }),
      });

      const data = (await response.json()) as
        | PlannerResponse
        | { error?: string };

      if (!response.ok || !("assistantMessage" in data)) {
        const errorMessage = "error" in data ? data.error : undefined;
        setError(errorMessage ?? "Failed to update meeting draft");
        return;
      }

      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.assistantMessage,
        },
      ]);
      setDraft(data.draft);
      setMissingFields(data.missingFields);
      setReadyToCreate(data.readyToCreate);
      setInterpretation(data.interpretation ?? null);
    } catch {
      setError("Failed to contact the meeting planner");
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleCreateMeeting() {
    if (!readyToCreate || isCreating || !draft.datetime) {
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      const payload = serializeDraftForCreate(draft);
      const response = await fetch("/api/v1/meetings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !data.id) {
        setError(data.error ?? "Failed to create meeting");
        return;
      }

      setIsConfirmOpen(false);
      router.push(`/meetings/${data.id}`);
    } catch {
      setError("Failed to create meeting");
    } finally {
      setIsCreating(false);
    }
  }

  function handleReset() {
    setMessages(createInitialMessages());
    setDraft(initialVisionMeetingDraft);
    setMissingFields(["datetime", "location"]);
    setReadyToCreate(false);
    setInput("");
    setError(null);
    setIsConfirmOpen(false);
    setInterpretation(null);
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void handleSendMessage();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.9fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            AI Vision Meeting Planner
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "assistant"
                    ? "bg-muted rounded-lg p-3 text-sm"
                    : "bg-primary text-primary-foreground ml-auto max-w-[90%] rounded-lg p-3 text-sm"
                }
              >
                {message.content}
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="meeting-planner-input">Message</Label>
            <Textarea
              id="meeting-planner-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Schedule a vision meeting next Monday at 7 PM at North Ridgeville High School..."
              className="min-h-28"
            />
            <p className="text-muted-foreground text-xs">
              Press Enter to send. Use Shift+Enter for a new line.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSendMessage}
              disabled={isPlanning || !input.trim()}
              className="cursor-pointer"
            >
              {isPlanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Thinking...
                </>
              ) : (
                "Send"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={isPlanning || isCreating}
              className="cursor-pointer"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Start Over
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meeting Draft</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase">
              Meeting Type
            </p>
            <p className="font-medium">Vision Meeting</p>
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase">
              Date & Time
            </p>
            <p>{renderValue(interpretation?.datetimeLabel)}</p>
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase">Location</p>
            <p>{renderValue(interpretation?.locationLabel)}</p>
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase">
              Estimated Attendance
            </p>
            <p>{renderValue(draft.estimatedAttendance)}</p>
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground text-xs uppercase">Notes</p>
            <p className="whitespace-pre-wrap">{renderValue(draft.notes)}</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-muted-foreground text-xs uppercase">
              Missing Information
            </p>
            {missingFields.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {missingFields.map((field) => (
                  <Badge key={field} variant="secondary">
                    {field === "datetime" ? "Date & Time" : "Location"}
                  </Badge>
                ))}
              </div>
            ) : (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                Ready to create
              </Badge>
            )}
          </div>

          <Button
            onClick={() => setIsConfirmOpen(true)}
            disabled={!readyToCreate || isPlanning || isCreating}
            className="w-full cursor-pointer"
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Meeting...
              </>
            ) : (
              "Create Meeting"
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create this vision meeting?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {buildCreateConfirmationMessage({
                datetimeLabel: interpretation?.datetimeLabel,
                locationLabel: interpretation?.locationLabel,
                estimatedAttendance: draft.estimatedAttendance,
                notes: draft.notes,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreating} className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleCreateMeeting();
              }}
              disabled={isCreating}
              className="cursor-pointer"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Meeting...
                </>
              ) : (
                "Create Meeting"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
