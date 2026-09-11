"use client";

import { Plus, FileUp, LoaderCircle } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  commitmentDocumentRefusal,
  COMMITMENT_DOCUMENT_ACCEPT,
} from "@/lib/people/commitment-document";

import {
  useEvryShell,
  type EvryPeopleFileSubmission,
  type EvryPeopleFileSubmissionResult,
} from "./evry-shell";
import type { PreparedEvryPeopleFile } from "./people-file-state";

type FileKind = EvryPeopleFileSubmission["kind"];

const ACCEPT: Record<FileKind, string> = {
  people_csv: ".csv,text/csv,application/vnd.ms-excel",
  person_photo: "image/jpeg,image/png,image/webp",
  commitment_document: COMMITMENT_DOCUMENT_ACCEPT,
};

export function EvryPeopleFileWorkflow() {
  const [open, setOpen] = useState(false);
  const { activeContext, isComposerBlocked, isSending, submitPeopleFile } =
    useEvryShell();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 cursor-pointer rounded-full"
          aria-label="Attach a file"
          disabled={isComposerBlocked || isSending}
        >
          <Plus aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a file</DialogTitle>
          <DialogDescription>
            Import people from a CSV, or add a photo or commitment document to a
            person.
          </DialogDescription>
        </DialogHeader>
        <EvryPeopleFileWorkflowForm
          personId={
            activeContext?.wire.kind === "person"
              ? activeContext.wire.recordId
              : null
          }
          isComposerBlocked={isComposerBlocked}
          isSending={isSending}
          submitPeopleFile={async (input) => {
            const result = await submitPeopleFile(input);
            if (result.status === "submitted") setOpen(false);
            return result;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EvryPeopleFileWorkflowForm(props: {
  personId: string | null;
  isComposerBlocked: boolean;
  isSending: boolean;
  submitPeopleFile(
    value: EvryPeopleFileSubmission
  ): Promise<EvryPeopleFileSubmissionResult>;
}) {
  const [kind, setKind] = useState<FileKind>("people_csv");
  const [file, setFile] = useState<File | null>(null);
  const [preparedCsv, setPreparedCsv] = useState<PreparedEvryPeopleFile | null>(
    null
  );
  const [duplicateResolutions, setDuplicateResolutions] = useState<
    Record<string, "skip" | "create" | "merge">
  >({});
  const [commitmentType, setCommitmentType] = useState<
    "core_group" | "launch_team"
  >("core_group");
  const [signedDate, setSignedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const personContext = props.personId;
  const id = useId();
  const needsPerson = kind !== "people_csv";
  const disabled =
    props.isComposerBlocked ||
    props.isSending ||
    !file ||
    (needsPerson && !personContext) ||
    (kind === "commitment_document" && !signedDate);

  function clearSelectedFile() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFile(null);
    setPreparedCsv(null);
    setDuplicateResolutions({});
    setFileError(null);
  }

  function selectFile(next: File | null) {
    setPreparedCsv(null);
    setDuplicateResolutions({});
    setFileError(null);
    if (kind === "commitment_document" && next) {
      const refusal = commitmentDocumentRefusal(next);
      if (refusal) {
        setFile(null);
        setFileError(refusal.message);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }
    setFile(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || disabled) return;
    const input: EvryPeopleFileSubmission =
      kind === "people_csv"
        ? {
            kind,
            file,
            prepared: preparedCsv,
            duplicateResolutions: preparedCsv ? duplicateResolutions : null,
          }
        : kind === "person_photo"
          ? { kind, file, personId: personContext! }
          : {
              kind,
              file,
              personId: personContext!,
              commitmentType,
              signedDate,
              notes: notes.length > 0 ? notes : null,
            };
    const result = await props.submitPeopleFile(input);
    if (result.status === "failed") {
      setFileError(
        result.message ?? "The file could not be prepared. Try again."
      );
    }
    if (result.status === "submitted") {
      clearSelectedFile();
      setNotes("");
    } else if (result.status === "needs_duplicate_resolution") {
      setPreparedCsv(result.prepared);
      setDuplicateResolutions(
        Object.fromEntries(
          result.prepared.duplicateRows.map((row) => [
            String(row.rowNumber),
            "skip" as const,
          ])
        )
      );
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.stopPropagation();
        return submit(event);
      }}
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        Evry previews the interpreted file and shows an exact confirmation
        before storing a photo, commitment, or imported person.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`${id}-kind`}>
            File task
          </label>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as FileKind);
              clearSelectedFile();
            }}
            disabled={props.isComposerBlocked || props.isSending}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] disabled:opacity-50"
          >
            <option value="people_csv">Preview and import People CSV</option>
            <option value="person_photo">Replace person photo</option>
            <option value="commitment_document">
              Record commitment document
            </option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`${id}-file`}>
            Choose file
          </label>
          <Input
            ref={fileInputRef}
            id={`${id}-file`}
            type="file"
            accept={ACCEPT[kind]}
            disabled={props.isComposerBlocked || props.isSending}
            required
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? `${id}-file-error` : undefined}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            className="h-auto min-h-10 py-1.5"
          />
          {fileError ? (
            <p
              id={`${id}-file-error`}
              role="alert"
              className="text-destructive text-xs"
            >
              {fileError}
            </p>
          ) : null}
        </div>
      </div>
      {needsPerson && !personContext ? (
        <p role="status" className="text-muted-foreground text-sm">
          Open the person’s record and launch Evry there to attach this file.
        </p>
      ) : null}
      {kind === "commitment_document" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${id}-type`}>
                Commitment
              </label>
              <select
                id={`${id}-type`}
                value={commitmentType}
                onChange={(event) =>
                  setCommitmentType(
                    event.target.value as "core_group" | "launch_team"
                  )
                }
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
              >
                <option value="core_group">Core group</option>
                <option value="launch_team">Launch team</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${id}-date`}>
                Signed date
              </label>
              <Input
                id={`${id}-date`}
                type="date"
                value={signedDate}
                required
                onChange={(event) => setSignedDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`${id}-notes`}>
              Notes (optional)
            </label>
            <Textarea
              id={`${id}-notes`}
              value={notes}
              maxLength={4_000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add context about this commitment"
            />
          </div>
        </div>
      ) : null}
      {kind === "people_csv" && preparedCsv ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Potential duplicates</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Choose a resolution for each matched CSV row. Every choice is
            disclosed again in the confirmation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {preparedCsv.duplicateRows.map((row) => (
              <div className="space-y-1.5" key={row.rowNumber}>
                <label
                  className="text-sm font-medium"
                  htmlFor={`${id}-duplicate-${row.rowNumber}`}
                >
                  {row.label}
                </label>
                <p className="text-muted-foreground text-xs">
                  Match: {row.mergeTarget}
                </p>
                <select
                  id={`${id}-duplicate-${row.rowNumber}`}
                  value={duplicateResolutions[String(row.rowNumber)] ?? "skip"}
                  onChange={(event) =>
                    setDuplicateResolutions((current) => ({
                      ...current,
                      [String(row.rowNumber)]: event.target.value as
                        | "skip"
                        | "create"
                        | "merge",
                    }))
                  }
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
                >
                  <option value="skip">Skip this row</option>
                  <option value="merge">Merge into the disclosed match</option>
                  <option value="create">Create a separate record</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={disabled}
          className="active:scale-[0.96] motion-reduce:transform-none"
        >
          {props.isSending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          {props.isSending
            ? "Preparing review…"
            : kind === "people_csv" && !preparedCsv
              ? "Check CSV"
              : "Prepare review"}
        </Button>
      </div>
    </form>
  );
}
