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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset");
    }
  };

  const handleInsertMergeField = (token: string) => {
    setBody((prev: string) => prev + token);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col lg:flex-row">
      {/* Left panel: Editor */}
      <div className="flex-1 overflow-auto border-r p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {isSystem && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm text-blue-800">
                This is a platform template. Editing will create a customized
                copy for your church. The original will remain available to
                other churches.
              </p>
            </div>
          )}

          {isForked && (
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                This is a customized copy of a platform template.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer text-amber-800 hover:text-amber-900"
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

          {error && <p className="text-sm text-red-600">{error}</p>}

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
      <div className="hidden w-[480px] flex-shrink-0 lg:block">
        <EmailPreview subject={subject} body={body} />
      </div>
    </div>
  );
}
