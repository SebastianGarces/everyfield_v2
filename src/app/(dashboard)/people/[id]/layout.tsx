import { HeaderBreadcrumbs } from "@/components/header";
import { verifySession } from "@/lib/auth/session";
import { mergedPersonDestination } from "@/lib/people/merge";
import { getPerson } from "@/lib/people/service";
import { notFound, redirect } from "next/navigation";

interface PersonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function PersonLayout({
  children,
  params,
}: PersonLayoutProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const person = await getPerson(user.churchId, id);

  if (!person) {
    const destination = await mergedPersonDestination(user.churchId, id);
    if (destination) redirect(`/people/${destination}`);
    notFound();
  }

  const personName =
    [person.firstName, person.lastName].filter(Boolean).join(" ") || "Person";

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "People & CRM", href: "/people" },
          { label: personName },
        ]}
      />
      {children}
    </>
  );
}
