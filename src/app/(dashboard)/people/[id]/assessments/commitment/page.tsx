import { AssessmentEntryShell } from "@/components/people/assessment-entry-shell";
import { CommitmentForm } from "@/components/people/commitment-form";

interface NewCommitmentPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewCommitmentPage({
  params,
}: NewCommitmentPageProps) {
  const { id } = await params;

  return (
    <AssessmentEntryShell
      personId={id}
      backTab="commitments"
      title="Record Commitment"
      renderForm={(person) => <CommitmentForm person={person} />}
    />
  );
}
