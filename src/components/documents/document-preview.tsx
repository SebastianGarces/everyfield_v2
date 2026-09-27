"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FORMAT_LABELS, type DocumentFormat } from "@/lib/documents/types";
import {
  documentPreviewSchema,
  type DocumentPreview,
} from "@/lib/documents/preview-model";

type PreviewState =
  | { url: string; kind: "loading" }
  | { url: string; kind: "error" }
  | { url: string; kind: "pdf"; objectUrl: string }
  | { url: string; kind: "office"; content: DocumentPreview };

export function DocumentPreviewPanel({
  url,
  format,
  onClose,
}: {
  url: string;
  format: DocumentFormat;
  onClose: () => void;
}) {
  const [state, setState] = useState<PreviewState>({ url, kind: "loading" });
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const timer = setTimeout(async () => {
      setState({ url, kind: "loading" });
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Preview request failed");
        if (format === "pdf") {
          if (
            !response.headers.get("content-type")?.includes("application/pdf")
          )
            throw new Error("Unexpected preview response");
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setState({ url, kind: "pdf", objectUrl });
        } else {
          const content = documentPreviewSchema.parse(await response.json());
          if (content.format !== format)
            throw new Error("Preview format changed");
          if (!controller.signal.aborted)
            setState({ url, kind: "office", content });
        }
      } catch {
        if (!controller.signal.aborted) setState({ url, kind: "error" });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, format, retry]);
  const current = state.url === url ? state : { url, kind: "loading" as const };
  return (
    <section
      aria-label="Document preview"
      className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          ref={heading}
          tabIndex={-1}
          className="font-semibold focus-visible:outline-2"
        >
          Preview · {FORMAT_LABELS[format]}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close preview
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Read-only preview of your merged content. Previewing does not add a
        document to history.
      </p>
      {current.kind === "loading" && (
        <p role="status" className="py-10 text-center">
          Preparing preview…
        </p>
      )}
      {current.kind === "error" && (
        <div role="alert" className="space-y-2">
          <p>Could not load the preview. Your entered values are still here.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setState({ url, kind: "loading" });
              setRetry((value) => value + 1);
            }}
          >
            Retry preview
          </Button>
        </div>
      )}
      {current.kind === "pdf" && (
        <iframe
          title="PDF document preview"
          src={current.objectUrl}
          className="h-[60dvh] min-h-80 w-full rounded border bg-white"
        />
      )}
      {current.kind === "office" && <OfficePreview content={current.content} />}
    </section>
  );
}

function OfficePreview({ content }: { content: DocumentPreview }) {
  if (content.format === "docx")
    return (
      <div className="max-h-[60dvh] space-y-3 overflow-auto rounded border bg-white p-4 text-slate-900 sm:p-8">
        {content.blocks.map((block, index) =>
          block.kind === "table" ? (
            <div key={index} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="border p-2 align-top whitespace-pre-wrap"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : block.heading ? (
            <h4
              key={index}
              className="text-lg font-semibold whitespace-pre-wrap"
            >
              {block.text}
            </h4>
          ) : (
            <p key={index} className="min-h-4 whitespace-pre-wrap">
              {block.text}
            </p>
          )
        )}
      </div>
    );
  return (
    <div className="max-h-[60dvh] space-y-5 overflow-auto rounded border bg-white p-3 text-slate-900">
      {content.sheets.map((sheet) => (
        <section key={sheet.name} className="space-y-2">
          <h4 className="font-semibold">{sheet.name}</h4>
          <p className="text-sm text-slate-600">
            Formula cells show the workbook’s current calculated values.
          </p>
          <div
            tabIndex={0}
            role="region"
            aria-label={`${sheet.name} spreadsheet`}
            className="overflow-x-auto focus-visible:outline-2"
          >
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border bg-slate-100 px-2 py-1" scope="col">
                    Row
                  </th>
                  {sheet.rows[0]?.map((_, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="border bg-slate-100 px-2 py-1"
                    >
                      {columnName(index)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, index) => (
                  <tr key={index}>
                    <th
                      scope="row"
                      className="border bg-slate-100 px-2 py-1 text-xs font-normal"
                    >
                      {index + 1}
                    </th>
                    {row.map((cell, column) => (
                      <td
                        key={column}
                        title={
                          cell.formula ? `Formula: ${cell.formula}` : undefined
                        }
                        className={`min-w-28 border p-2 align-top whitespace-pre-wrap ${column === 0 ? "min-w-64" : ""} ${cell.bold ? "font-semibold" : ""}`}
                      >
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
function columnName(index: number): string {
  let value = index + 1,
    name = "";
  while (value) {
    value--;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
