"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/shared/rich-text-editor";
import { sendMessageAction } from "@/app/(dashboard)/communication/actions";
// Zone-pinned, not `toLocaleDateString`: this picker renders in the browser
// while the meeting pages render on the server, and an unpinned formatter makes
// the two disagree about the same meeting (React #418).
// memory/invariants.md → Date & Time Rendering.
import { formatDateTime } from "@/lib/datetime";
import {
  extractMergeFields,
  getSampleData,
  buildMeetingMergeData,
  MERGE_FIELDS,
} from "@/lib/communication/merge";
// The body is rich text (COM-017). Templates and drafts written before it are
// plain text; `toRichTextHtml` is the one door that converts them on the way in.
import { isRichTextEmpty, toRichTextHtml } from "@/lib/rich-text/format";
import { meetingTypeLabel } from "@/lib/meetings/labels";
import type { MessageTemplate } from "@/db/schema/communication";
import type { RecipientTeamOption } from "@/lib/communication/recipient-groups";

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
  /**
   * `church_meetings.agenda` as stored. Carried so the live preview can render
   * `{{meeting_agenda}}` from the meeting actually selected, rather than
   * leaving the sample agenda on screen while the rest of the preview switches
   * to real data.
   */
  agenda: unknown;
}

interface ComposeFormProps {
  templates: MessageTemplate[];
  initialTemplate?: MessageTemplate;
  meetingId?: string;
  meetings?: MeetingOption[];
  initialRecipients?: Recipient[];
  churchName?: string;
  teams?: RecipientTeamOption[];
}

export function ComposeForm({
  templates,
  initialTemplate,
  meetingId: initialMeetingId,
  meetings = [],
  initialRecipients = [],
  churchName = "",
  teams = [],
}: ComposeFormProps) {
  const router = useRouter();

  const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
  const [body, setBody] = useState(() =>
    toRichTextHtml(initialTemplate?.body ?? "")
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    initialTemplate?.id ?? ""
  );
  const [selectedMeetingId, setSelectedMeetingId] = useState(
    initialMeetingId ?? ""
  );
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect if the current content uses meeting merge fields
  const meetingFieldNames = useMemo(
    () =>
      new Set(
        MERGE_FIELDS.filter((f) => f.group === "meeting").map((f) => f.name)
      ),
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
          agenda: meeting.agenda,
        });
        Object.assign(base, meetingData);
      }
    }

    return base;
  }, [churchName, selectedMeetingId, meetings]);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<RichTextEditorHandle>(null);
  const lastFocusedRef = useRef<"subject" | "body">("body");

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setSubject(template.subject ?? "");
      setBody(toRichTextHtml(template.body));
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
      } else {
        // The body is contentEditable now, so the caret belongs to the editor —
        // it inserts at its own selection rather than the form splicing a
        // string, which is what keeps a token landing INSIDE a bold run.
        bodyRef.current?.insertText(token);
      }
    },
    [subject]
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
    // `<p><br></p>` is what an emptied editor leaves behind — truthy, and a
    // `.trim()` guard would wave a blank email straight through.
    if (isRichTextEmpty(body)) {
      setError("Please enter a message body");
      return;
    }
    if (needsMeeting) {
      setError(
        meetings.length === 0
          ? "This template uses meeting fields, but you have no upcoming meetings. Schedule one, or pick a template without meeting fields."
          : "This template uses meeting fields — please select a meeting"
      );
      return;
    }

    setSending(true);
    setError(null);

    const formData = new FormData();
    formData.set("subject", subject);
    formData.set("body", body);
    formData.set("channel", "email");
    formData.set("recipientIds", JSON.stringify(recipients.map((r) => r.id)));
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
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Left panel: Editor */}
      <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:border-r">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Template selector. Disabled when there is nothing to pick: an
              enabled trigger over an empty list opens an invisible popover
              and reads as broken (#610). */}
          <div className="space-y-2">
            <Label htmlFor="message-template">Template (optional)</Label>
            <Select
              value={selectedTemplateId}
              onValueChange={handleTemplateChange}
              disabled={templates.length === 0}
            >
              <SelectTrigger id="message-template" className="cursor-pointer">
                <SelectValue
                  placeholder={
                    templates.length === 0
                      ? "No templates yet"
                      : "Select a template..."
                  }
                />
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
              <Label htmlFor="message-meeting">Meeting</Label>
              {needsMeeting && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {meetings.length === 0 ? (
                    <span>
                      This template uses meeting fields, but you have no
                      upcoming meetings.{" "}
                      <Link
                        href="/meetings/new"
                        className="font-medium underline underline-offset-2"
                      >
                        Schedule a meeting
                      </Link>{" "}
                      to fill them in.
                    </span>
                  ) : (
                    <span>
                      This template uses meeting fields. Select a meeting to
                      fill them in.
                    </span>
                  )}
                </div>
              )}
              <Select
                value={selectedMeetingId}
                onValueChange={setSelectedMeetingId}
                disabled={meetings.length === 0}
              >
                <SelectTrigger id="message-meeting" className="cursor-pointer">
                  <SelectValue
                    placeholder={
                      meetings.length === 0
                        ? "No upcoming meetings"
                        : "Select a meeting..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {meetings.map((m) => (
                    <SelectItem
                      key={m.id}
                      value={m.id}
                      className="cursor-pointer"
                    >
                      {m.title ?? meetingTypeLabel(m.type)} —{" "}
                      {formatDateTime(new Date(m.datetime), "short")}
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
            teams={teams}
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
            <RichTextEditor
              ref={bodyRef}
              id="body"
              aria-label="Message"
              value={body}
              onChange={setBody}
              onFocus={() => (lastFocusedRef.current = "body")}
              placeholder="Write your message..."
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
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
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
      <div className="hidden w-[42%] max-w-[30rem] min-w-[22rem] shrink-0 lg:block">
        <EmailPreview
          subject={subject}
          body={body}
          mergeData={previewMergeData}
        />
      </div>
    </div>
  );
}
