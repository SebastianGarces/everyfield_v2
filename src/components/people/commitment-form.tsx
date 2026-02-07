"use client";

import { createCommitmentAction } from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CommitmentType, Person } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

interface CommitmentFormProps {
  person: Person;
  onSuccess?: () => void;
}

const COMMITMENT_TYPES: {
  value: CommitmentType;
  label: string;
  description: string;
}[] = [
  {
    value: "core_group",
    label: "Core Group",
    description: "Initial commitment to join the church planting team",
  },
  {
    value: "launch_team",
    label: "Launch Team",
    description: "Commitment to serve on the launch team",
  },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

export function CommitmentForm({ person, onSuccess }: CommitmentFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [commitmentType, setCommitmentType] =
    useState<CommitmentType>("core_group");
  const [signedDate, setSignedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Check if person has been interviewed
  const statusOrder = [
    "prospect",
    "attendee",
    "following_up",
    "interviewed",
    "committed",
    "core_group",
    "launch_team",
    "leader",
  ];
  const currentStatusIndex = statusOrder.indexOf(person.status);
  const interviewedIndex = statusOrder.indexOf("interviewed");
  const showWarning = currentStatusIndex < interviewedIndex;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setFileError(
        "Invalid file type. Only PDF, JPG, and PNG files are allowed."
      );
      setSelectedFile(null);
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setFileError("File is too large. Maximum size is 10MB.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const removeFile = () => {
    setSelectedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      const formData = new FormData();
      formData.append("personId", person.id);
      formData.append("commitmentType", commitmentType);
      formData.append("signedDate", signedDate);
      if (notes) formData.append("notes", notes);
      if (selectedFile) formData.append("document", selectedFile);

      const result = await createCommitmentAction(formData);

      if (result.success) {
        toast.success("Commitment recorded", {
          description: "Person has been advanced to Committed status.",
        });
        onSuccess?.();
        router.push(`/people/${person.id}/assessments?tab=commitments`);
      } else {
        toast.error("Failed to record commitment", {
          description: result.error,
        });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {showWarning && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            This person hasn&apos;t been interviewed yet. You can still record
            the commitment, but typically commitments are recorded after an
            interview.
          </AlertDescription>
        </Alert>
      )}

      {/* Commitment Type */}
      <div className="space-y-3">
        <Label>Commitment Type</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {COMMITMENT_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setCommitmentType(type.value)}
              disabled={isPending}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                commitmentType === type.value
                  ? "border-primary bg-primary/5 ring-primary ring-2"
                  : "border-input bg-background hover:border-primary/50"
              )}
            >
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="font-medium">{type.label}</span>
              </div>
              <span className="text-muted-foreground text-sm">
                {type.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Signed Date */}
      <div className="space-y-2">
        <Label htmlFor="signedDate">Date Signed</Label>
        <Input
          id="signedDate"
          type="date"
          value={signedDate}
          onChange={(e) => setSignedDate(e.target.value)}
          disabled={isPending}
          required
          className="w-48"
        />
      </div>

      {/* Document Upload */}
      <div className="space-y-2">
        <Label>Document (Optional)</Label>
        <p className="text-muted-foreground text-sm">
          Upload a photo or scan of the signed commitment card
        </p>

        {selectedFile ? (
          <div className="bg-muted/50 flex items-center gap-3 rounded-lg border p-3">
            <FileText className="text-muted-foreground h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{selectedFile.name}</p>
              <p className="text-muted-foreground text-sm">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeFile}
              disabled={isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors",
              "hover:border-primary/50 hover:bg-muted/50",
              fileError && "border-red-500/50 bg-red-50"
            )}
          >
            <Upload className="text-muted-foreground h-8 w-8" />
            <div className="text-center">
              <label
                htmlFor="document"
                className="text-primary cursor-pointer font-medium hover:underline"
              >
                Click to upload
              </label>
              <p className="text-muted-foreground text-sm">
                PDF, JPG, or PNG up to 10MB
              </p>
            </div>
            <input
              ref={fileInputRef}
              id="document"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={handleFileChange}
              disabled={isPending}
              className="sr-only"
            />
          </div>
        )}

        {fileError && <p className="text-sm text-red-600">{fileError}</p>}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (Optional)</Label>
        <Textarea
          id="notes"
          placeholder="Add any additional notes about this commitment..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          className="min-h-[100px]"
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Record Commitment
        </Button>
      </div>
    </form>
  );
}
