import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

interface TeamsPageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/login");
  }

  const { id } = await params;

  return (
    <PersonProfileWrapper personId={id} activeTab="teams">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team Assignments</CardTitle>
            <CardDescription>
              Depends on Ministry Team Management (F8)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Team assignments and roles will be displayed here once the
              Ministry Team Management feature is implemented.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Training Progress</CardTitle>
            <CardDescription>
              Depends on Ministry Team Management (F8)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Training completion status and certifications will be tracked
              here.
            </p>
          </CardContent>
        </Card>
      </div>
    </PersonProfileWrapper>
  );
}
