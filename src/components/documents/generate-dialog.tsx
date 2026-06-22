"use client";

import { Download, Eye, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { DocumentMergeValues, DocumentTemplate } from "@/lib/documents";

function buildUrl(
  templateId: string,
  values: DocumentMergeValues,
  preview: boolean
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  if (preview) params.set("preview", "1");
  const query = params.toString();
  return `/api/documents/${templateId}${query ? `?${query}` : ""}`;
}

interface GenerateDialogProps {
  template: DocumentTemplate;
  /** Auto-fill defaults resolved server-side (keyed by merge-field key). */
  defaults: DocumentMergeValues;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateDialog({
  template,
  defaults,
  open,
  onOpenChange,
}: GenerateDialogProps) {
  const [values, setValues] = useState<DocumentMergeValues>(() => {
    const initial: DocumentMergeValues = {};
    for (const field of template.mergeFields) {
      initial[field.key] = defaults[field.key] ?? "";
    }
    return initial;
  });

  const missingRequired = template.mergeFields.some(
    (f) => f.required && !values[f.key]?.trim()
  );

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleDownload() {
    const url = buildUrl(template.id, values, false);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${template.id}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function handlePreview() {
    window.open(buildUrl(template.id, values, true), "_blank", "noopener");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="text-muted-foreground h-5 w-5" />
            Generate: {template.name}
          </DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Merge Fields
          </p>
          {template.mergeFields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`mf-${field.key}`}>
                {field.label}
                {field.required && (
                  <span className="text-destructive ml-0.5">*</span>
                )}
              </Label>
              <Input
                id={`mf-${field.key}`}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(e) => setValue(field.key, e.target.value)}
              />
              {field.autoFill && (
                <p className="text-muted-foreground text-xs">
                  Auto-filled from your church profile — edit if needed.
                </p>
              )}
              {field.description && (
                <p className="text-muted-foreground text-xs">
                  {field.description}
                </p>
              )}
            </div>
          ))}

          {template.relatedWikiSlug && (
            <>
              <Separator />
              <Link
                href={`/wiki/${template.relatedWikiSlug}`}
                className="text-primary text-sm hover:underline"
              >
                Read the related wiki article →
              </Link>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={handlePreview}
            disabled={missingRequired}
          >
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            onClick={handleDownload}
            disabled={missingRequired}
          >
            <Download className="mr-2 h-4 w-4" />
            Generate &amp; Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
