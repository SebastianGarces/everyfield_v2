"use client";

import { FileUp, LoaderCircle } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useEvryShell, type EvryPeopleFileSubmission } from "./evry-shell";

type FileKind = EvryPeopleFileSubmission["kind"];

const ACCEPT: Record<FileKind, string> = {
  people_csv: ".csv,text/csv,application/vnd.ms-excel",
  person_photo: "image/jpeg,image/png,image/webp",
  commitment_document: "application/pdf,image/jpeg,image/png,image/webp",
};

export function EvryPeopleFileWorkflow() {
  const { activeContext, isComposerBlocked, isSending, submitPeopleFile } =
    useEvryShell();
  return (
    <EvryPeopleFileWorkflowForm
      personId={
        activeContext?.wire.kind === "person"
          ? activeContext.wire.recordId
          : null
      }
      isComposerBlocked={isComposerBlocked}
      isSending={isSending}
      submitPeopleFile={submitPeopleFile}
    />
  );
}

export function EvryPeopleFileWorkflowForm(props: {
  personId: string | null;
  isComposerBlocked: boolean;
  isSending: boolean;
  submitPeopleFile(value: EvryPeopleFileSubmission): Promise<boolean>;
}) {
  const [kind, setKind] = useState<FileKind>("people_csv");
  const [file, setFile] = useState<File | null>(null);
  const [duplicateDisposition, setDuplicateDisposition] = useState<
    "skip" | "create" | "merge"
  >("skip");
  const [commitmentType, setCommitmentType] = useState<
    "core_group" | "launch_team"
  >("core_group");
  const [signedDate, setSignedDate] = useState("");
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
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || disabled) return;
    const input: EvryPeopleFileSubmission =
      kind === "people_csv"
        ? { kind, file, duplicateDisposition }
        : kind === "person_photo"
          ? { kind, file, personId: personContext! }
          : {
              kind,
              file,
              personId: personContext!,
              commitmentType,
              signedDate,
            };
    if (await props.submitPeopleFile(input)) clearSelectedFile();
  }

  return (
    <details className="bg-muted/35 rounded-lg p-3">
      <summary className="focus-visible:ring-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
        <FileUp aria-hidden="true" className="size-4" />
        Review a People file
      </summary>
      <form className="mt-3 space-y-3" onSubmit={submit}>
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
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="h-auto min-h-10 py-1.5"
            />
          </div>
        </div>
        {needsPerson && !personContext ? (
          <p role="status" className="text-muted-foreground text-sm">
            Open the person’s record and launch Evry there to attach this file.
          </p>
        ) : null}
        {kind === "commitment_document" ? (
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
        ) : null}
        {kind === "people_csv" ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`${id}-duplicates`}>
              Potential duplicates
            </label>
            <select
              id={`${id}-duplicates`}
              value={duplicateDisposition}
              onChange={(event) =>
                setDuplicateDisposition(
                  event.target.value as "skip" | "create" | "merge"
                )
              }
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] sm:max-w-sm"
            >
              <option value="skip">Skip matched rows</option>
              <option value="merge">Merge into the disclosed match</option>
              <option value="create">Create separate records</option>
            </select>
            <p className="text-muted-foreground text-xs leading-relaxed">
              This choice applies only to rows the preview identifies as
              duplicates and is disclosed again in the confirmation.
            </p>
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
            {props.isSending ? "Preparing review…" : "Prepare review"}
          </Button>
        </div>
      </form>
    </details>
  );
}
