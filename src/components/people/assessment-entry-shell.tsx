import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PersonForClient } from "@/lib/people/types";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { getPerson } from "@/lib/people/service";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

interface AssessmentEntryShellProps {
  personId: string;
  /** The ?tab= value the back arrow returns to */
  backTab: "assessments" | "interviews" | "commitments";
  title: string;
  /** Renders the entry form once the person is resolved */
  renderForm: (person: PersonForClient) => React.ReactNode;
}

/**
 * Server component shared by the three assessment entry routes (4 C's,
 * interview, commitment): the session check, the person lookup with
 * notFound(), and the Card + back-arrow header exist once here — each route
 * only names its title, back tab and form.
 */
export async function AssessmentEntryShell({
  personId,
  backTab,
  title,
  renderForm,
}: AssessmentEntryShellProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // AS-020 rule 3: all three entry routes exist only to WRITE — a 4 C's
  // assessment, an interview, a commitment card — and each save is
  // `people.write`. Hiding the six buttons that link here is not enough; a
  // typed URL would otherwise open a full form that is refused at submit.
  //
  // ONE GATE FOR THREE ROUTES, because the shell is what those three routes
  // are: their page files name only a title, a back tab and a form. Back to the
  // history they may read.
  if (!holdsSeatFor(user, "people.write")) {
    redirect(`/people/${personId}/assessments?tab=${backTab}`);
  }

  const person = await getPerson(user.churchId, personId);

  if (!person) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl p-6 pb-24">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/people/${personId}/assessments?tab=${backTab}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <CardTitle className="text-2xl">{title}</CardTitle>
              <CardDescription>
                {person.firstName} {person.lastName}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>{renderForm(person)}</CardContent>
      </Card>
    </div>
  );
}
