import { verifySession } from "@/lib/auth/session";
import { getLatestCommitment } from "@/lib/people/commitments";
import { getHousehold, getHouseholdMembers } from "@/lib/people/household";
import { getPerson } from "@/lib/people/service";
import { getPersonSkills } from "@/lib/people/skills";
import { getPersonTags, listTags } from "@/lib/people/tags";
import { notFound, redirect } from "next/navigation";
import { PersonDetailClient } from "./person-detail-client";

interface PersonDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonDetailPage({
  params,
}: PersonDetailPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/login");
  }

  const { id } = await params;

  const [person, personTags, availableTags, latestCommitment, skills] =
    await Promise.all([
      getPerson(user.churchId, id),
      getPersonTags(user.churchId, id),
      listTags(user.churchId),
      getLatestCommitment(user.churchId, id),
      getPersonSkills(user.churchId, id),
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
    <PersonDetailClient
      person={person}
      tags={personTags}
      availableTags={availableTags}
      latestCommitment={latestCommitment}
      household={household}
      householdMembers={householdMembers}
      skills={skills}
    />
  );
}
