import { z } from "zod";

import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import { getAssessments, getInterviews } from "@/lib/people/assessments";
import { getCommitments, getLatestCommitment } from "@/lib/people/commitments";
import { checkForDuplicates } from "@/lib/people/duplicates";
import {
  getHousehold,
  getHouseholdMembers,
  listHouseholds,
} from "@/lib/people/household";
import { getPipelineData } from "@/lib/people/pipeline";
import { getEvryPersonPhotoSnapshot } from "@/lib/people/person-photo";
import { getPerson, listPeople } from "@/lib/people/service";
import { getPersonSkills } from "@/lib/people/skills";
import { getPersonTags, listTags } from "@/lib/people/tags";

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
const uuidSchema = z.string().uuid();
const personInput = z.strictObject({ personId: uuidSchema });
const householdInput = z.strictObject({ householdId: uuidSchema });

export const PEOPLE_READ_IDENTITIES = {
  person: "people.crm.people.get-person",
  morePeople: "people.crm.people.load-more-people",
  photo: "people.crm.people.get-person-photo",
  pipeline: "people.crm.stages.get-pipeline-data",
  household: "people.crm.households.get-household",
  households: "people.crm.households.list-households",
  householdMembers: "people.crm.households.get-household-members",
  tags: "people.crm.tags.list-tags",
  personTags: "people.crm.tags.get-person-tags",
  personSkills: "people.crm.skills.get-person-skills",
  assessments: "people.crm.assessments.get-assessments",
  interviews: "people.crm.assessments.get-interviews",
  commitments: "people.crm.assessments.get-commitments",
  latestCommitment: "people.crm.assessments.get-latest-commitment",
  duplicates: "people.crm.duplicates.check-for-duplicates",
} as const;

export type PeopleReadSelection =
  | Readonly<{ kind: "person" }>
  | Readonly<{ kind: "more_people"; cursor: string }>
  | Readonly<{ kind: "photo" }>
  | Readonly<{ kind: "pipeline" }>
  | Readonly<{ kind: "households" }>
  | Readonly<{ kind: "household"; householdId: string }>
  | Readonly<{ kind: "household_members"; householdId: string }>
  | Readonly<{ kind: "tags" }>
  | Readonly<{ kind: "person_tags" }>
  | Readonly<{ kind: "person_skills" }>
  | Readonly<{
      kind: "person_assessments" | "person_interviews" | "person_commitments";
    }>
  | Readonly<{ kind: "latest_commitment" }>
  | Readonly<{
      kind: "duplicates";
      email: string | null;
      firstName: string;
      lastName: string;
      phone: string | null;
    }>;

function uuidMatch(pattern: RegExp, value: string): string | null {
  const candidate = pattern.exec(value)?.[1];
  return candidate && uuidSchema.safeParse(candidate).success
    ? candidate
    : null;
}

/** Closed, operation-specific People read selection. */
export function selectPeopleRead(
  literalUserText: string
): PeopleReadSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  if (/^show (?:this )?person(?: profile)?[.!?]*$/i.test(text))
    return { kind: "person" };
  if (/^show (?:this )?person(?:'s)? photo[.!?]*$/i.test(text))
    return { kind: "photo" };
  if (/^show (?:the )?people pipeline[.!?]*$/i.test(text))
    return { kind: "pipeline" };
  if (/^list households[.!?]*$/i.test(text)) return { kind: "households" };
  if (/^list tags[.!?]*$/i.test(text)) return { kind: "tags" };
  if (/^show (?:this )?person(?:'s)? tags[.!?]*$/i.test(text))
    return { kind: "person_tags" };
  if (/^show (?:this )?person(?:'s)? skills[.!?]*$/i.test(text))
    return { kind: "person_skills" };
  if (/^show (?:this )?person(?:'s)? assessments[.!?]*$/i.test(text))
    return { kind: "person_assessments" };
  if (/^show (?:this )?person(?:'s)? interviews[.!?]*$/i.test(text))
    return { kind: "person_interviews" };
  if (/^show (?:this )?person(?:'s)? commitments[.!?]*$/i.test(text))
    return { kind: "person_commitments" };
  if (/^show (?:this )?person(?:'s)? latest commitment[.!?]*$/i.test(text))
    return { kind: "latest_commitment" };
  const cursor = uuidMatch(
    new RegExp(`^load more people after\\s+${UUID}[.!?]*$`, "i"),
    text
  );
  if (cursor) return { kind: "more_people", cursor };
  const members = uuidMatch(
    new RegExp(`^show household\\s+${UUID}\\s+members[.!?]*$`, "i"),
    text
  );
  if (members) return { kind: "household_members", householdId: members };
  const household = uuidMatch(
    new RegExp(`^show household\\s+${UUID}[.!?]*$`, "i"),
    text
  );
  if (household) return { kind: "household", householdId: household };
  const duplicate =
    /^check duplicates:\s*([^;]*);\s*([^;]*);\s*([^;]*);\s*([^;]*)$/i.exec(
      text
    );
  if (duplicate) {
    const email = duplicate[1]?.trim() || null;
    const firstName = duplicate[2]?.trim() ?? "";
    const lastName = duplicate[3]?.trim() ?? "";
    const phone = duplicate[4]?.trim() || null;
    if (email || (firstName && lastName) || phone) {
      return { kind: "duplicates", email, firstName, lastName, phone };
    }
  }
  return null;
}

function personName(person: { firstName: string; lastName: string }): string {
  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") || "Person"
  );
}

function personLink(personId: string, label: string) {
  return trustedEvryApplicationSourceLink({
    label,
    href: `/people/${personId}`,
  });
}

function peopleLink(label = "Open People") {
  return trustedEvryApplicationSourceLink({ label, href: "/people" });
}

function personContext(
  pageContext: Readonly<{ kind: string; recordId: string }> | null
): string | null {
  return pageContext?.kind === "person" ? pageContext.recordId : null;
}

const PERSON_READ = defineEvryReadRegistration({
  id: "people.person",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.person,
  inputShape: personInput.shape,
  async run({ authorization }, input) {
    const person = await getPerson(authorization.actor.plantId, input.personId);
    return buildEvryReadArtifact({
      title: person ? personName(person) : "Person not found",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: person
        ? []
        : [{ reason: "Not found in this plant", count: 1 }],
      items: person
        ? [
            {
              id: person.id,
              label: personName(person),
              facts: [
                { label: "Status", value: person.status },
                { label: "Email", value: person.email ?? "Not set" },
                { label: "Phone", value: person.phone ?? "Not set" },
              ],
              sourceLink: personLink(person.id, `Open ${personName(person)}`),
            },
          ]
        : [],
      sourceLinks: person
        ? [personLink(person.id, `Open ${personName(person)}`)]
        : [],
    });
  },
});

const MORE_PEOPLE_READ = defineEvryReadRegistration({
  id: "people.more",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.morePeople,
  inputShape: { cursor: uuidSchema },
  async run({ authorization }, input) {
    const page = await listPeople(authorization.actor.plantId, {
      cursor: input.cursor,
      limit: 25,
    });
    return buildEvryReadArtifact({
      title: "More people",
      filters: [{ label: "After person", value: input.cursor }],
      exclusions: [],
      items: page.people.map((person) => ({
        id: person.id,
        label: personName(person),
        facts: [{ label: "Status", value: person.status }],
        sourceLink: personLink(person.id, `Open ${personName(person)}`),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open People",
          href: "/people",
        }),
      ],
    });
  },
});

const PHOTO_READ = defineEvryReadRegistration({
  id: "people.photo",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.photo,
  inputShape: personInput.shape,
  async run({ authorization }, input) {
    const [person, photo] = await Promise.all([
      getPerson(authorization.actor.plantId, input.personId),
      getEvryPersonPhotoSnapshot(authorization.actor.plantId, input.personId),
    ]);
    const hasPhoto = Boolean(person && photo?.present);
    return buildEvryReadArtifact({
      title: "Person photo",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: person
        ? []
        : [{ reason: "Not found in this plant", count: 1 }],
      items: person
        ? [
            {
              id: person.id,
              label: personName(person),
              facts: [
                { label: "Photo", value: hasPhoto ? "Available" : "Not set" },
              ],
              sourceLink: hasPhoto
                ? trustedEvryApplicationSourceLink({
                    label: `View ${personName(person)} photo`,
                    href: `/api/people/${person.id}/photo`,
                  })
                : personLink(person.id, `Open ${personName(person)}`),
            },
          ]
        : [],
      sourceLinks: person
        ? [personLink(person.id, `Open ${personName(person)}`)]
        : [],
    });
  },
});

const PIPELINE_READ = defineEvryReadRegistration({
  id: "people.pipeline",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.pipeline,
  inputShape: {},
  async run({ authorization }) {
    const pipeline = await getPipelineData(authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: "People pipeline",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: pipeline.columns.map((column) => ({
        id: column.id,
        label: column.title,
        facts: [{ label: "People", value: String(column.count) }],
        sourceLink: trustedEvryApplicationSourceLink({
          label: `Open ${column.title}`,
          href: `/people?view=pipeline`,
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open pipeline",
          href: "/people?view=pipeline",
        }),
      ],
    });
  },
});

const HOUSEHOLDS_READ = defineEvryReadRegistration({
  id: "people.households",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.households,
  inputShape: {},
  async run({ authorization }) {
    const rows = await listHouseholds(authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: "Households",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: rows.map((row) => ({
        id: row.id,
        label: row.name,
        facts: [{ label: "City", value: row.city ?? "Not set" }],
        sourceLink: peopleLink(),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open People",
          href: "/people",
        }),
      ],
    });
  },
});

const HOUSEHOLD_READ = defineEvryReadRegistration({
  id: "people.household",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.household,
  inputShape: householdInput.shape,
  async run({ authorization }, input) {
    const row = await getHousehold(
      authorization.actor.plantId,
      input.householdId
    );
    return buildEvryReadArtifact({
      title: row?.name ?? "Household not found",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: row ? [] : [{ reason: "Not found in this plant", count: 1 }],
      items: row
        ? [
            {
              id: row.id,
              label: row.name,
              facts: [
                {
                  label: "Address",
                  value:
                    [row.addressLine1, row.city, row.state, row.postalCode]
                      .filter(Boolean)
                      .join(", ") || "Not set",
                },
              ],
              sourceLink: peopleLink(),
            },
          ]
        : [],
      sourceLinks: [],
    });
  },
});

const HOUSEHOLD_MEMBERS_READ = defineEvryReadRegistration({
  id: "people.household-members",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.householdMembers,
  inputShape: householdInput.shape,
  async run({ authorization }, input) {
    const [household, members] = await Promise.all([
      getHousehold(authorization.actor.plantId, input.householdId),
      getHouseholdMembers(authorization.actor.plantId, input.householdId),
    ]);
    return buildEvryReadArtifact({
      title: household ? `${household.name} members` : "Household not found",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: household
        ? []
        : [{ reason: "Not found in this plant", count: 1 }],
      items: household
        ? members.map((person) => ({
            id: person.id,
            label: personName(person),
            facts: [
              {
                label: "Household role",
                value: person.householdRole ?? "Member",
              },
            ],
            sourceLink: personLink(person.id, `Open ${personName(person)}`),
          }))
        : [],
      sourceLinks: [],
    });
  },
});

const TAGS_READ = defineEvryReadRegistration({
  id: "people.tags",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.tags,
  inputShape: {},
  async run({ authorization }) {
    const rows = await listTags(authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: "People tags",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: rows.map((row) => ({
        id: row.id,
        label: row.name,
        facts: [{ label: "Color", value: row.color ?? "Not set" }],
        sourceLink: peopleLink(),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open People",
          href: "/people",
        }),
      ],
    });
  },
});

function personCollectionRead(input: {
  id: string;
  capabilityIdentity: string;
  title: string;
  load(
    plantId: string,
    personId: string
  ): Promise<Array<Record<string, unknown>>>;
  project(row: Record<string, unknown>): {
    id: string;
    label: string;
    facts: { label: string; value: string }[];
  };
}) {
  return defineEvryReadRegistration({
    id: input.id,
    capabilityIdentity: input.capabilityIdentity,
    inputShape: personInput.shape,
    async run({ authorization }, readInput) {
      const person = await getPerson(
        authorization.actor.plantId,
        readInput.personId
      );
      const rows = person
        ? await input.load(authorization.actor.plantId, person.id)
        : [];
      return buildEvryReadArtifact({
        title: person
          ? `${input.title} for ${personName(person)}`
          : "Person not found",
        filters: [{ label: "Plant", value: "Current plant" }],
        exclusions: person
          ? []
          : [{ reason: "Not found in this plant", count: 1 }],
        items: rows.map((row) => ({
          ...input.project(row),
          sourceLink: person
            ? personLink(person.id, `Open ${personName(person)}`)
            : peopleLink(),
        })),
        sourceLinks: person
          ? [personLink(person.id, `Open ${personName(person)}`)]
          : [],
      });
    },
  });
}

const PERSON_TAGS_READ = personCollectionRead({
  id: "people.person-tags",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.personTags,
  title: "Tags",
  load: getPersonTags,
  project: (row) => ({
    id: String(row.id),
    label: String(row.name),
    facts: [
      {
        label: "Color",
        value: typeof row.color === "string" ? row.color : "Not set",
      },
    ],
  }),
});
const PERSON_SKILLS_READ = personCollectionRead({
  id: "people.person-skills",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.personSkills,
  title: "Skills",
  load: getPersonSkills,
  project: (row) => ({
    id: String(row.id),
    label: String(row.skillName),
    facts: [
      { label: "Category", value: String(row.skillCategory) },
      {
        label: "Proficiency",
        value:
          typeof row.proficiency === "string" ? row.proficiency : "Not set",
      },
    ],
  }),
});
const ASSESSMENTS_READ = personCollectionRead({
  id: "people.assessments",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.assessments,
  title: "Assessments",
  load: getAssessments,
  project: (row) => ({
    id: String(row.id),
    label: String(row.assessmentDate),
    facts: [{ label: "Total score", value: String(row.totalScore) }],
  }),
});
const INTERVIEWS_READ = personCollectionRead({
  id: "people.interviews",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.interviews,
  title: "Interviews",
  load: getInterviews,
  project: (row) => ({
    id: String(row.id),
    label: String(row.interviewDate),
    facts: [{ label: "Result", value: String(row.overallResult) }],
  }),
});
const COMMITMENTS_READ = personCollectionRead({
  id: "people.commitments",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.commitments,
  title: "Commitments",
  load: getCommitments,
  project: (row) => ({
    id: String(row.id),
    label: String(row.commitmentType),
    facts: [{ label: "Signed", value: String(row.signedDate) }],
  }),
});

const LATEST_COMMITMENT_READ = defineEvryReadRegistration({
  id: "people.latest-commitment",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.latestCommitment,
  inputShape: personInput.shape,
  async run({ authorization }, input) {
    const [person, row] = await Promise.all([
      getPerson(authorization.actor.plantId, input.personId),
      getLatestCommitment(authorization.actor.plantId, input.personId),
    ]);
    const visible = person ? row : undefined;
    return buildEvryReadArtifact({
      title: person
        ? `Latest commitment for ${personName(person)}`
        : "Person not found",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: person
        ? []
        : [{ reason: "Not found in this plant", count: 1 }],
      items: visible
        ? [
            {
              id: visible.id,
              label: visible.commitmentType,
              facts: [
                { label: "Signed", value: visible.signedDate },
                { label: "Notes", value: visible.notes ?? "Not set" },
              ],
              sourceLink: personLink(person!.id, `Open ${personName(person!)}`),
            },
          ]
        : [],
      sourceLinks: person
        ? [personLink(person.id, `Open ${personName(person)}`)]
        : [],
    });
  },
});

const DUPLICATES_READ = defineEvryReadRegistration({
  id: "people.duplicates",
  capabilityIdentity: PEOPLE_READ_IDENTITIES.duplicates,
  inputShape: {
    email: z.string().email().nullable(),
    firstName: z.string().max(255),
    lastName: z.string().max(255),
    phone: z.string().max(50).nullable(),
  },
  async run({ authorization }, input) {
    const result = await checkForDuplicates(authorization.actor.plantId, input);
    const matches = [
      ...(result.exactMatch ? [result.exactMatch] : []),
      ...result.potentialMatches,
    ];
    return buildEvryReadArtifact({
      title: "Possible duplicate people",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: matches.map((person, index) => ({
        id: person.id,
        label: personName(person),
        facts: [
          {
            label: "Match",
            value:
              index === 0 && result.exactMatch ? "Exact email" : "Potential",
          },
        ],
        sourceLink: personLink(person.id, `Open ${personName(person)}`),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open People",
          href: "/people",
        }),
      ],
    });
  },
});

export const PEOPLE_DOMAIN_READ_REGISTRATIONS = [
  PERSON_READ,
  MORE_PEOPLE_READ,
  PHOTO_READ,
  PIPELINE_READ,
  HOUSEHOLDS_READ,
  HOUSEHOLD_READ,
  HOUSEHOLD_MEMBERS_READ,
  TAGS_READ,
  PERSON_TAGS_READ,
  PERSON_SKILLS_READ,
  ASSESSMENTS_READ,
  INTERVIEWS_READ,
  COMMITMENTS_READ,
  LATEST_COMMITMENT_READ,
  DUPLICATES_READ,
] as const;

export const continuePeopleDomainRead = createEvryReadContinuation({
  registrations: PEOPLE_DOMAIN_READ_REGISTRATIONS,
  async select({ literalUserText, pageContext, eligibleReadIds }) {
    const selection = selectPeopleRead(literalUserText);
    if (!selection) return null;
    const currentPerson = personContext(pageContext);
    const selected = (() => {
      switch (selection.kind) {
        case "person":
          return currentPerson
            ? { registration: PERSON_READ, input: { personId: currentPerson } }
            : null;
        case "photo":
          return currentPerson
            ? { registration: PHOTO_READ, input: { personId: currentPerson } }
            : null;
        case "more_people":
          return {
            registration: MORE_PEOPLE_READ,
            input: { cursor: selection.cursor },
          };
        case "pipeline":
          return { registration: PIPELINE_READ, input: {} };
        case "households":
          return { registration: HOUSEHOLDS_READ, input: {} };
        case "household":
          return {
            registration: HOUSEHOLD_READ,
            input: { householdId: selection.householdId },
          };
        case "household_members":
          return {
            registration: HOUSEHOLD_MEMBERS_READ,
            input: { householdId: selection.householdId },
          };
        case "tags":
          return { registration: TAGS_READ, input: {} };
        case "person_tags":
          return currentPerson
            ? {
                registration: PERSON_TAGS_READ,
                input: { personId: currentPerson },
              }
            : null;
        case "person_skills":
          return currentPerson
            ? {
                registration: PERSON_SKILLS_READ,
                input: { personId: currentPerson },
              }
            : null;
        case "person_assessments":
          return currentPerson
            ? {
                registration: ASSESSMENTS_READ,
                input: { personId: currentPerson },
              }
            : null;
        case "person_interviews":
          return currentPerson
            ? {
                registration: INTERVIEWS_READ,
                input: { personId: currentPerson },
              }
            : null;
        case "person_commitments":
          return currentPerson
            ? {
                registration: COMMITMENTS_READ,
                input: { personId: currentPerson },
              }
            : null;
        case "latest_commitment":
          return currentPerson
            ? {
                registration: LATEST_COMMITMENT_READ,
                input: { personId: currentPerson },
              }
            : null;
        case "duplicates":
          return { registration: DUPLICATES_READ, input: selection };
      }
    })();
    return selected && eligibleReadIds.includes(selected.registration.id)
      ? { readId: selected.registration.id, input: selected.input }
      : null;
  },
});
