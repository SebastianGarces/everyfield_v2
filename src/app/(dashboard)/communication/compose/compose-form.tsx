"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecipientPicker } from "@/components/communication/recipient-picker";
import { MergeFieldInserter } from "@/components/communication/merge-field-inserter";
import { EmailPreview } from "@/components/communication/email-preview";
import { sendMessageAction } from "@/app/(dashboard)/communication/actions";
import {
  extractMergeFields,
  getSampleData,
  buildMeetingMergeData,
  MERGE_FIELDS,
} from "@/lib/communication/merge";
import type { MessageTemplate } from "@/db/schema/communication";

interface Recipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface MeetingOption {
  id: string;
  title: string | null;
  type: string;
  datetime: string;
  locationName: string | null;
  locationAddress: string | null;
}

const meetingTypeLabels: Record<string, string> = {
  vision_meeting: "Vision Meeting",
  orientation: "Orientation",
  team_meeting: "Team Meeting",
};

interface ComposeFormProps {
  templates: MessageTemplate[];
  initialTemplate?: MessageTemplate;
  meetingId?: string;
  meetings?: MeetingOption[];
  initialRecipients?: Recipient[];
  churchName?: string;
}

export function ComposeForm({
  templates,
  initialTemplate,
  meetingId: initialMeetingId,
  meetings = [],
  initialRecipients = [],
  churchName = "",
}: ComposeFormProps) {
  const router = useRouter();

  // Auto-suggest a template when coming from a meeting context without an explicit template
  const autoTemplate = useMemo(() => {
    if (initialTemplate || !initialMeetingId) return null;
    const meeting = meetings.find((m) => m.id === initialMeetingId);
    if (!meeting) return null;

    // Map meeting type to template name patterns
    const typePatterns: Record<string, string[]> = {
      vision_meeting: ["Vision Meeting Invitation"],
      orientation: ["Orientation Invitation"],
      team_meeting: ["Team Meeting Invitation"],
    };
    const patterns = typePatterns[meeting.type] ?? [];

    // Find a matching invitation template
    return templates.find(
      (t) =>
        t.category === "meeting_invitation" &&
        patterns.some((p) => t.name.includes(p))
    ) ?? null;
  }, [initialTemplate, initialMeetingId, meetings, templates]);

  const effectiveTemplate = initialTemplate ?? autoTemplate;

  const [subject, setSubject] = useState(effectiveTemplate?.subject ?? "");
  const [body, setBody] = useState(effectiveTemplate?.body ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    effectiveTemplate?.id ?? ""
  );
  const [selectedMeetingId, setSelectedMeetingId] = useState(initialMeetingId ?? "");
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect if the current content uses meeting merge fields
  const meetingFieldNames = useMemo(
    () => new Set(MERGE_FIELDS.filter((f) => f.group === "meeting").map((f) => f.name)),
    []
  );
  const usedFields = useMemo(
    () => extractMergeFields(`${subject} ${body}`),
    [subject, body]
  );
  const hasMeetingFields = useMemo(
    () => usedFields.some((f) => meetingFieldNames.has(f)),
    [usedFields, meetingFieldNames]
  );
  const needsMeeting = hasMeetingFields && !selectedMeetingId;

  // Build merge data for the live preview using actual selected meeting + church data
  const previewMergeData = useMemo(() => {
    const base = getSampleData();

    // Override with real church name if available
    if (churchName) {
      base.church_name = churchName;
    }

    // Override with real meeting data if a meeting is selected
    if (selectedMeetingId) {
      const meeting = meetings.find((m) => m.id === selectedMeetingId);
      if (meeting) {
        const meetingData = buildMeetingMergeData({
          title: meeting.title,
          type: meeting.type,
          datetime: new Date(meeting.datetime),
          locationName: meeting.locationName,
          locationAddress: meeting.locationAddress,
        });
        Object.assign(base, meetingData);
      }
    }

    return base;
  }, [churchName, selectedMeetingId, meetings]);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusedRef = useRef<"subject" | "body">("body");

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setSubject(template.subject ?? "");
      setBody(template.body);
    }
  };

  const handleInsertMergeField = useCallback(
    (token: string) => {
      const target = lastFocusedRef.current;
      if (target === "subject" && subjectRef.current) {
        const input = subjectRef.current;
        const start = input.selectionStart ?? subject.length;
        const end = input.selectionEnd ?? subject.length;
        const newValue =
          subject.substring(0, start) + token + subject.substring(end);
        setSubject(newValue);
        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(start + token.length, start + token.length);
        });
      } else if (bodyRef.current) {
        const textarea = bodyRef.current;
        const start = textarea.selectionStart ?? body.length;
        const end = textarea.selectionEnd ?? body.length;
        const newValue =
          body.substring(0, start) + token + body.substring(end);
        setBody(newValue);
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(
            start + token.length,
            start + token.length
          );
        });
      }
    },
    [subject, body]
  );

  const handleSend = async () => {
    if (recipients.length === 0) {
      setError("Please add at least one recipient");
      return;
    }
    if (!subject.trim()) {
      setError("Please enter a subject");
      return;
    }
    if (!body.trim()) {
      setError("Please enter a message body");
      return;
    }
    if (needsMeeting) {
      setError("This template uses meeting fields — please select a meeting");
      return;
    }

    setSending(true);
    setError(null);

    const formData = new FormData();
    formData.set("subject", subject);
    formData.set("body", body);
    formData.set("channel", "email");
    formData.set(
      "recipientIds",
      JSON.stringify(recipients.map((r) => r.id))
    );
    if (selectedTemplateId) formData.set("templateId", selectedTemplateId);
    if (selectedMeetingId) formData.set("meetingId", selectedMeetingId);

    try {
      const result = await sendMessageAction(formData);

      if (result.error) {
        setError(result.error);
        setSending(false);
      } else {
        router.push(`/communication/${result.communicationId}`);
      }
    } catch {
      setError("Failed to send message. Please try again.");
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col lg:flex-row">
      {/* Left panel: Editor */}
      <div className="flex-1 overflow-auto border-r p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Template selector */}
          <div className="space-y-2">
            <Label>Template (optional)</Label>
            <Select
              value={selectedTemplateId}
              onValueChange={handleTemplateChange}
            >
              <SelectTrigger className="cursor-pointer">
                <SelectValue placeholder="Select a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    className="cursor-pointer"
                  >
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Meeting selector — shown when template uses meeting fields */}
          {hasMeetingFields && (
            <div className="space-y-2">
              <Label>Meeting</Label>
              {needsMeeting && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  This template uses meeting fields. Select a meeting to fill them in.
                </div>
              )}
              <Select
                value={selectedMeetingId}
                onValueChange={setSelectedMeetingId}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue placeholder="Select a meeting..." />
                </SelectTrigger>
                <SelectContent>
                  {meetings.map((m) => (
                    <SelectItem
                      key={m.id}
                      value={m.id}
                      className="cursor-pointer"
                    >
                      {m.title ?? meetingTypeLabels[m.type] ?? m.type} —{" "}
                      {new Date(m.datetime).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Recipients */}
          <RecipientPicker
            selected={recipients}
            onChange={setRecipients}
            showMeetingGroups={!!selectedMeetingId}
          />

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              ref={subjectRef}
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => (lastFocusedRef.current = "subject")}
              placeholder="Email subject line..."
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <Textarea
              ref={bodyRef}
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => (lastFocusedRef.current = "body")}
              placeholder="Write your message..."
              className="min-h-[240px] resize-y font-mono text-sm"
            />
          </div>

          {/* Merge field inserter */}
          <MergeFieldInserter
            onInsert={handleInsertMergeField}
            groups={
              selectedMeetingId || hasMeetingFields
                ? ["person", "church", "meeting"]
                : ["person", "church"]
            }
          />

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {/* Send button */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => router.push("/communication")}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Right panel: Live Preview */}
      <div className="hidden w-[480px] shrink-0 lg:block">
        <EmailPreview subject={subject} body={body} mergeData={previewMergeData} />
      </div>
    </div>
  );
}
