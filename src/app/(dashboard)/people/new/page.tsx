import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { PersonForm } from "@/components/people/person-form";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function NewPersonPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // AS-020 rule 3: this route exists only to WRITE, so hiding the buttons that
  // link here is not enough — a Member who types the URL would otherwise walk
  // into a full form and be refused at save. Back to the directory, which they
  // may read.
  if (!holdsSeatFor(user, "people.write")) {
    redirect("/people");
  }

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "People & CRM", href: "/people" },
          { label: "Add Person" },
        ]}
      />
      <PageCanvas>
        <WorkspacePanel className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle className="text-2xl">Add Person</CardTitle>
            <CardDescription>Add a new person to your contacts</CardDescription>
          </CardHeader>
          <CardContent>
            <PersonForm mode="create" />
          </CardContent>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
