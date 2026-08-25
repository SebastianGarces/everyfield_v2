"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MergeFieldInserter } from "@/components/communication/merge-field-inserter";
import { EmailPreview } from "@/components/communication/email-preview";
import {
  updateTemplateAction,
  deleteTemplateAction,
} from "@/app/(dashboard)/communication/actions";
import type { MessageTemplate } from "@/db/schema/communication";

interface TemplateEditorProps {
  template: MessageTemplate;
}

export function TemplateEditor({ template }: TemplateEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isForked = !!template.sourceTemplateId;
  const isSystem = template.isSystem;

  // --------------------------------------------------------------------------
  // BOTH BUTTONS LEAVE, SO NEITHER REFRESHES (#228, #526, #529)
  // --------------------------------------------------------------------------
  //
  // memory/invariants.md → Client/Server Data Synchronization: a click that
  // navigates owns no refresh on the route being LEFT. Both handlers below used
  // to `router.push(...)` and then `router.refresh()` on the very next line —
  // the refresh re-renders the editor the push is replacing, which is the
  // arrangement measured to strand the navigation while the write still lands.
  //
  // Nothing is lost by dropping it. Both actions call
  // `revalidatePath("/communication/templates")`, so the list the reader arrives
  // at is already re-rendered from the database — and the destination is a page,
  // not a shared layout, so unlike the notifications bell (#527) there is no
  // segment the push reuses and no reconcile owed after it.
  //
  // `saving` is cleared on the FAILURE path only, for the same reason: on the
  // way out, re-enabling Save while the push is in flight invites a second write
  // of a template the reader has stopped looking at.
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateTemplateAction(template.id, {
        name,
        description: description || undefined,
        subject: subject || undefined,
        body,
      });
      router.push("/communication/templates");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !isForked ||
      !confirm(
        "Reset this template to the platform default? Your customizations will be lost."
      )
    ) {
      return;
    }

    try {
      await deleteTemplateAction(template.id);
      router.push("/communication/templates");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset");
    }
  };

  const handleInsertMergeField = (token: string) => {
    setBody((prev: string) => prev + token);
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Left panel: Editor */}
      <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:border-r">
        <div className="mx-auto max-w-2xl space-y-6">
          {isSystem && (
            <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
              <p className="text-foreground text-sm">
                This is a platform template. Editing will create a customized
                copy for your church. The original will remain available to
                other churches.
              </p>
            </div>
          )}

          {isForked && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-50 p-3 dark:bg-amber-950/20">
              <p className="text-sm text-amber-900 dark:text-amber-200">
                This is a customized copy of a platform template.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer text-amber-900 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-100"
                onClick={handleReset}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Reset to Default
              </Button>
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of when to use this template..."
            />
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject Line</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject..."
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="body">Message Body</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[280px] resize-y font-mono text-sm"
            />
          </div>

          {/* Merge fields */}
          <MergeFieldInserter onInsert={handleInsertMergeField} />

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => router.push("/communication/templates")}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Template
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Right panel: Live Preview */}
      <div className="hidden w-[42%] max-w-[30rem] min-w-[22rem] shrink-0 lg:block">
        <EmailPreview subject={subject} body={body} />
      </div>
    </div>
  );
}
