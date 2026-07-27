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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  FORMAT_LABELS,
  type DocumentFormat,
  type DocumentMergeValues,
  type DocumentTemplate,
} from "@/lib/documents";
import { wikiHref } from "@/lib/wiki/href";

function buildUrl(
  templateId: string,
  format: DocumentFormat,
  values: DocumentMergeValues,
  preview: boolean
): string {
  const params = new URLSearchParams();
  params.set("format", format);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  if (preview) params.set("preview", "1");
  return `/api/documents/${templateId}?${params.toString()}`;
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
  const [format, setFormat] = useState<DocumentFormat>(template.formats[0]);

  const missingRequired = template.mergeFields.some(
    (f) => f.required && !values[f.key]?.trim()
  );

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleDownload() {
    const url = buildUrl(template.id, format, values, false);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${template.id}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function handlePreview() {
    window.open(
      buildUrl(template.id, "pdf", values, true),
      "_blank",
      "noopener"
    );
  }

  const canPreview = template.formats.includes("pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="generate-dialog">
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

          {/* Always shown, even for single-format templates: arriving here from
              a contextual link (DOC-014) must land on a format choice, never a
              blind download. */}
          <Separator />
          <div className="space-y-2" data-testid="format-picker">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Format
            </p>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as DocumentFormat)}
              className="flex gap-6"
              aria-label="Output format"
            >
              {template.formats.map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={f}
                    id={`fmt-${template.id}-${f}`}
                    className="cursor-pointer"
                  />
                  <Label
                    htmlFor={`fmt-${template.id}-${f}`}
                    className="cursor-pointer font-normal"
                  >
                    {FORMAT_LABELS[f]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {template.relatedWikiSlug && (
            <>
              <Separator />
              <Link
                href={wikiHref(template.relatedWikiSlug)}
                className="text-primary text-sm hover:underline"
              >
                Read the related wiki article →
              </Link>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {canPreview && (
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
          )}
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
