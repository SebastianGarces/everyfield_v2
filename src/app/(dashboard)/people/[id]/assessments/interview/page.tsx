import { InterviewForm } from "@/components/people/interview-form";
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

interface NewInterviewPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewInterviewPage({
  params,
}: NewInterviewPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
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
              <Link href={`/people/${id}/assessments?tab=interviews`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <CardTitle className="text-2xl">Member Interview</CardTitle>
              <CardDescription>
                {person.firstName} {person.lastName}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <InterviewForm person={person} />
        </CardContent>
      </Card>
    </div>
  );
}
