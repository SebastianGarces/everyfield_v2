import { verifySession } from "@/lib/auth/session";
import { getHousehold } from "@/lib/people/household";
import { getPerson } from "@/lib/people/service";
import { notFound, redirect } from "next/navigation";
import { PersonProfileShell } from "./person-profile-shell";

interface PersonProfileWrapperProps {
  personId: string;
  activeTab: "overview" | "activity" | "assessments" | "teams" | "communication";
  children: React.ReactNode;
}

/**
 * Server component that fetches person + household data and renders the
 * shared profile shell (header, tabs, single-column layout).
 *
 * Used by activity, assessments, and teams tab pages so they don't need to
 * re-implement the header.
 */
export async function PersonProfileWrapper({
  personId,
  activeTab,
  children,
}: PersonProfileWrapperProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const person = await getPerson(user.churchId, personId);

  if (!person) {
    notFound();
  }

  // Fetch household data for the header (shows household name)
  const household = person.householdId
    ? await getHousehold(user.churchId, person.householdId)
    : null;

  return (
    <PersonProfileShell
      person={person}
      activeTab={activeTab}
      household={household}
    >
      {children}
    </PersonProfileShell>
  );
}
