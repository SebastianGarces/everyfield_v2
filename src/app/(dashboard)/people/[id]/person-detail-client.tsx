"use client";

import { PersonOverview } from "@/components/people";
import { PersonProfileShell } from "@/components/people/person-profile-shell";
import type { Commitment, Household, SkillInventory } from "@/db/schema";
import type { Person, Tag } from "@/lib/people/types";

interface PersonDetailClientProps {
  person: Person;
  tags: Tag[];
  availableTags: Tag[];
  latestCommitment?: Commitment | null;
  household?: Household | null;
  householdMembers?: Person[];
  skills?: SkillInventory[];
}

export function PersonDetailClient({
  person,
  tags,
  availableTags,
  latestCommitment,
  household,
  householdMembers = [],
  skills = [],
}: PersonDetailClientProps) {
  return (
    <PersonProfileShell
      person={person}
      activeTab="overview"
      household={household}
    >
      <PersonOverview
        person={person}
        tags={tags}
        availableTags={availableTags}
        latestCommitment={latestCommitment}
        skills={skills}
        household={household}
        householdMembers={householdMembers}
      />
    </PersonProfileShell>
  );
}
