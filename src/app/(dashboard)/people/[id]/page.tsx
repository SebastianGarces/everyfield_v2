import { PersonOverview } from "@/components/people";
import { PersonProfileShell } from "@/components/people/person-profile-shell";
import { verifySession } from "@/lib/auth/session";
import { getLatestCommitment } from "@/lib/people/commitments";
import {
  getHousehold,
  getHouseholdMembers,
  listHouseholds,
} from "@/lib/people/household";
import { getPerson } from "@/lib/people/service";
import { getPersonSkills } from "@/lib/people/skills";
import { getPersonTags, listTags } from "@/lib/people/tags";
import { notFound, redirect } from "next/navigation";

interface PersonDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonDetailPage({
  params,
}: PersonDetailPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;

  const [
    person,
    personTags,
    availableTags,
    latestCommitment,
    skills,
    households,
  ] = await Promise.all([
    getPerson(user.churchId, id),
    getPersonTags(user.churchId, id),
    listTags(user.churchId),
    getLatestCommitment(user.churchId, id),
    getPersonSkills(user.churchId, id),
    // The full household list rides along server-side so HouseholdManager
    // never has to fetch it from an effect (invariants → Client/Server Data
    // Synchronization)
    listHouseholds(user.churchId),
  ]);

  if (!person) {
    notFound();
  }

  // Fetch household data if person belongs to one
  const household = person.householdId
    ? await getHousehold(user.churchId, person.householdId)
    : null;

  const householdMembers = household
    ? await getHouseholdMembers(user.churchId, household.id)
    : [];

  return (
    <PersonProfileShell
      person={person}
      activeTab="overview"
      household={household}
    >
      <PersonOverview
        person={person}
        tags={personTags}
        availableTags={availableTags}
        latestCommitment={latestCommitment}
        skills={skills}
        household={household}
        householdMembers={householdMembers}
        households={households}
      />
    </PersonProfileShell>
  );
}
