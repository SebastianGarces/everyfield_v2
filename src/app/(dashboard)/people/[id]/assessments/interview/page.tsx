import { AssessmentEntryShell } from "@/components/people/assessment-entry-shell";
import { InterviewForm } from "@/components/people/interview-form";

interface NewInterviewPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewInterviewPage({
  params,
}: NewInterviewPageProps) {
  const { id } = await params;

  return (
    <AssessmentEntryShell
      personId={id}
      backTab="interviews"
      title="Member Interview"
      renderForm={(person) => <InterviewForm person={person} />}
    />
  );
}
