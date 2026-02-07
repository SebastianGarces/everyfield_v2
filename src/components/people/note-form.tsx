"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type ActivityWithPerformer } from "@/lib/people/activity.shared";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface NoteFormProps {
  personId: string;
  currentUserId: string;
  /** Called to add a note - parent handles optimistic update and server action */
  onAddNote: (
    note: string,
    optimisticActivity: ActivityWithPerformer
  ) => Promise<void>;
  /** Whether the parent is processing a transition */
  isPending?: boolean;
}

export function NoteForm({
  personId,
  currentUserId,
  onAddNote,
  isPending,
}: NoteFormProps) {
  const [note, setNote] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() || isPending) return;

    const noteText = note.trim();
    setNote(""); // Clear immediately for better UX

    // Create optimistic activity for immediate display
    const optimisticActivity: ActivityWithPerformer = {
      id: `optimistic-${Date.now()}`,
      churchId: "", // Will be filled by server
      personId,
      activityType: "note_added",
      metadata: { note: noteText },
      performedBy: currentUserId,
      createdAt: new Date(),
      performer: null, // Will be filled by server
    };

    try {
      await onAddNote(noteText, optimisticActivity);
      toast.success("Note added");
    } catch (error) {
      console.error(error);
      toast.error("Failed to add note");
      // Restore the note text on error so user doesn't lose their input
      setNote(noteText);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        placeholder="Add a note..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={isPending}
        rows={2}
        className="min-h-0 resize-none"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending || !note.trim()}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Note
        </Button>
      </div>
    </form>
  );
}
