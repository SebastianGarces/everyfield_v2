"use client";

import {
  downloadCsvTemplateAction,
  executeBulkImportAction,
  previewImportAction,
} from "@/app/(dashboard)/people/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ImportPreview,
  ImportRow,
  ImportSummary,
} from "@/lib/people/types";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type WizardStep = "upload" | "preview" | "importing" | "results";

interface ImportWizardProps {
  children?: React.ReactNode;
}

export function ImportWizard({ children }: ImportWizardProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("upload");
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [duplicateResolutions, setDuplicateResolutions] = useState<
    Record<number, "skip" | "create">
  >({});
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function reset() {
    setStep("upload");
    setPreview(null);
    setSummary(null);
    setImportProgress(0);
    setDuplicateResolutions({});
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      reset();
    }
    setOpen(newOpen);
  }

  async function handleDownloadTemplate() {
    startTransition(async () => {
      const result = await downloadCsvTemplateAction();
      if (!result.success) {
        toast.error("Failed to generate template");
        return;
      }

      // Create and download the file
      const blob = new Blob([result.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "people-import-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function handleFileUpload(file: File) {
    setError(null);

    if (!file.name.endsWith(".csv")) {
      setError("Please upload a CSV file.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("File size must be less than 5MB.");
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);

      const result = await previewImportAction(formData);

      if (!result.success) {
        setError(result.error);
        return;
      }

      if (result.data.totalRows === 0) {
        setError("The CSV file is empty or has no data rows.");
        return;
      }

      setPreview(result.data);

      // Default all duplicate rows to "skip"
      const defaultResolutions: Record<number, "skip" | "create"> = {};
      for (const row of result.data.duplicateRows) {
        defaultResolutions[row.rowNumber] = "skip";
      }
      setDuplicateResolutions(defaultResolutions);

      setStep("preview");
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleImport() {
    if (!preview) return;

    setStep("importing");
    setImportProgress(0);

    startTransition(async () => {
      // Combine valid rows and duplicate rows (with their resolutions)
      const allRows = [...preview.validRows, ...preview.duplicateRows];

      // Simulate progress (the actual import is a single server action)
      const progressInterval = setInterval(() => {
        setImportProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const result = await executeBulkImportAction(
        allRows,
        duplicateResolutions
      );

      clearInterval(progressInterval);
      setImportProgress(100);

      if (!result.success) {
        setError(result.error);
        setStep("preview");
        return;
      }

      setSummary(result.data);
      setStep("results");
      router.refresh();
    });
  }

  function toggleDuplicateResolution(rowNumber: number) {
    setDuplicateResolutions((prev) => ({
      ...prev,
      [rowNumber]: prev[rowNumber] === "skip" ? "create" : "skip",
    }));
  }

  const totalToImport = preview
    ? preview.validRows.length +
      Object.values(duplicateResolutions).filter((v) => v === "create").length
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        {step === "upload" && (
          <UploadStep
            isPending={isPending}
            error={error}
            fileInputRef={fileInputRef}
            onDownloadTemplate={handleDownloadTemplate}
            onFileUpload={handleFileUpload}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClose={() => handleOpenChange(false)}
          />
        )}

        {step === "preview" && preview && (
          <PreviewStep
            preview={preview}
            duplicateResolutions={duplicateResolutions}
            totalToImport={totalToImport}
            isPending={isPending}
            error={error}
            onToggleResolution={toggleDuplicateResolution}
            onImport={handleImport}
            onBack={() => {
              setStep("upload");
              setPreview(null);
              setError(null);
            }}
          />
        )}

        {step === "importing" && <ImportingStep progress={importProgress} />}

        {step === "results" && summary && (
          <ResultsStep
            summary={summary}
            onClose={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Step Components
// ============================================================================

function UploadStep({
  isPending,
  error,
  fileInputRef,
  onDownloadTemplate,
  onFileUpload,
  onDrop,
  onDragOver,
  onClose,
}: {
  isPending: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDownloadTemplate: () => void;
  onFileUpload: (file: File) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import People</DialogTitle>
        <DialogDescription>
          Import contacts from a CSV file. Download the template to see the
          expected format.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Download template */}
        <Button
          variant="outline"
          className="w-full"
          onClick={onDownloadTemplate}
          disabled={isPending}
        >
          <Download className="mr-2 h-4 w-4" />
          Download CSV Template
        </Button>

        {/* File upload area */}
        <div
          className="border-muted-foreground/25 hover:border-muted-foreground/50 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors"
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          {isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              <p className="text-muted-foreground text-sm">
                Processing file...
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="text-muted-foreground h-8 w-8" />
              <p className="text-sm font-medium">
                Drop your CSV file here, or click to browse
              </p>
              <p className="text-muted-foreground text-xs">
                CSV files up to 5MB
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload(file);
            }}
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function PreviewStep({
  preview,
  duplicateResolutions,
  totalToImport,
  isPending,
  error,
  onToggleResolution,
  onImport,
  onBack,
}: {
  preview: ImportPreview;
  duplicateResolutions: Record<number, "skip" | "create">;
  totalToImport: number;
  isPending: boolean;
  error: string | null;
  onToggleResolution: (rowNumber: number) => void;
  onImport: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Preview Import</DialogTitle>
        <DialogDescription>
          Review the data before importing. {preview.totalRows} rows found.
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-96 space-y-4 overflow-y-auto py-4">
        {/* Summary badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="default">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {preview.validRows.length} valid
          </Badge>
          {preview.invalidRows.length > 0 && (
            <Badge variant="destructive">
              <XCircle className="mr-1 h-3 w-3" />
              {preview.invalidRows.length} invalid
            </Badge>
          )}
          {preview.duplicateRows.length > 0 && (
            <Badge variant="secondary">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {preview.duplicateRows.length} duplicates
            </Badge>
          )}
        </div>

        {/* Invalid rows */}
        {preview.invalidRows.length > 0 && (
          <div>
            <h4 className="text-destructive mb-2 text-sm font-medium">
              Invalid Rows (will be skipped)
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Errors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.invalidRows.map((row) => (
                  <InvalidRowDisplay key={row.rowNumber} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Duplicate rows */}
        {preview.duplicateRows.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Potential Duplicates</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.duplicateRows.map((row) => (
                  <DuplicateRowDisplay
                    key={row.rowNumber}
                    row={row}
                    resolution={duplicateResolutions[row.rowNumber] ?? "skip"}
                    onToggle={() => onToggleResolution(row.rowNumber)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Valid rows preview */}
        {preview.validRows.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">
              Ready to Import ({preview.validRows.length})
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.validRows.slice(0, 10).map((row) => (
                  <TableRow key={row.rowNumber}>
                    <TableCell className="text-muted-foreground">
                      {row.rowNumber}
                    </TableCell>
                    <TableCell>
                      {row.data.firstName} {row.data.lastName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.data.email || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.data.phone || "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {preview.validRows.length > 10 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-muted-foreground text-center"
                    >
                      ...and {preview.validRows.length - 10} more
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="ghost" onClick={onBack} disabled={isPending}>
          Back
        </Button>
        <Button onClick={onImport} disabled={isPending || totalToImport === 0}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Import {totalToImport} {totalToImport === 1 ? "Person" : "People"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ImportingStep({ progress }: { progress: number }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Importing...</DialogTitle>
        <DialogDescription>
          Please wait while records are being created.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="text-primary h-10 w-10 animate-spin" />
        <Progress value={progress} className="w-full max-w-xs" />
        <p className="text-muted-foreground text-sm">{progress}% complete</p>
      </div>
    </>
  );
}

function ResultsStep({
  summary,
  onClose,
}: {
  summary: ImportSummary;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import Complete</DialogTitle>
        <DialogDescription>
          Here&apos;s a summary of the import results.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-4 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-green-500" />
            <p className="text-2xl font-bold">{summary.created}</p>
            <p className="text-muted-foreground text-xs">Created</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <AlertTriangle className="text-muted-foreground mx-auto mb-2 h-6 w-6" />
            <p className="text-2xl font-bold">{summary.skipped}</p>
            <p className="text-muted-foreground text-xs">Skipped</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <XCircle className="mx-auto mb-2 h-6 w-6 text-red-500" />
            <p className="text-2xl font-bold">{summary.errors}</p>
            <p className="text-muted-foreground text-xs">Errors</p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

// ============================================================================
// Row Display Components
// ============================================================================

function InvalidRowDisplay({ row }: { row: ImportRow }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
      <TableCell>
        {row.data.firstName || "?"} {row.data.lastName || "?"}
      </TableCell>
      <TableCell>
        <ul className="text-destructive list-inside list-disc text-xs">
          {row.errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      </TableCell>
    </TableRow>
  );
}

function DuplicateRowDisplay({
  row,
  resolution,
  onToggle,
}: {
  row: ImportRow;
  resolution: "skip" | "create";
  onToggle: () => void;
}) {
  const match = row.duplicates.exactMatch ?? row.duplicates.potentialMatches[0];
  const matchLabel = row.duplicates.exactMatch
    ? "Exact match"
    : "Similar name/phone";

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
      <TableCell>
        {row.data.firstName} {row.data.lastName}
      </TableCell>
      <TableCell>
        {match && (
          <div className="text-xs">
            <span className="text-muted-foreground">{matchLabel}:</span>{" "}
            {match.firstName} {match.lastName}
            {match.email && (
              <span className="text-muted-foreground"> ({match.email})</span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {resolution === "skip" ? (
            <span className="text-muted-foreground text-xs">Skip</span>
          ) : (
            <span className="text-xs">Create</span>
          )}
        </Button>
      </TableCell>
    </TableRow>
  );
}
