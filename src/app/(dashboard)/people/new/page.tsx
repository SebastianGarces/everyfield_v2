import { HeaderBreadcrumbs } from "@/components/header";
import { PersonForm } from "@/components/people/person-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function NewPersonPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/login");
  }

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "People & CRM", href: "/people" },
          { label: "Add Person" },
        ]}
      />
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Add Person</CardTitle>
            <CardDescription>
              Add a new person to your contacts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PersonForm mode="create" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
