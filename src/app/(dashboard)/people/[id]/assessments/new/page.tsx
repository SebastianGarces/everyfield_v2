import { AssessmentEntryShell } from "@/components/people/assessment-entry-shell";
import { AssessmentForm } from "@/components/people/assessment-form";

interface NewAssessmentPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewAssessmentPage({
  params,
}: NewAssessmentPageProps) {
  const { id } = await params;

  return (
    <AssessmentEntryShell
      personId={id}
      backTab="assessments"
      title="4 C's Assessment"
      renderForm={(person) => <AssessmentForm person={person} />}
    />
  );
}
