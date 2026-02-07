import { CommitmentForm } from "@/components/people/commitment-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { getPerson } from "@/lib/people/service";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

interface NewCommitmentPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewCommitmentPage({
  params,
}: NewCommitmentPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/login");
  }

  const { id } = await params;
  const person = await getPerson(user.churchId, id);

  if (!person) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl p-6 pb-24">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/people/${id}/assessments?tab=commitments`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <CardTitle className="text-2xl">Record Commitment</CardTitle>
              <CardDescription>
                {person.firstName} {person.lastName}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CommitmentForm person={person} />
        </CardContent>
      </Card>
    </div>
  );
}
