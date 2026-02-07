"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Commitment, Household, SkillInventory } from "@/db/schema";
import type { Person, Tag } from "@/lib/people/types";
import { format } from "date-fns";
import {
  Calendar,
  FileSignature,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Tag as TagIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HouseholdMembers } from "./household-members";
import { SkillsList } from "./skills-list";
import { TagPicker } from "./tag-picker";

interface PersonOverviewProps {
  person: Person;
  tags?: Tag[];
  availableTags?: Tag[];
  latestCommitment?: Commitment | null;
  skills?: SkillInventory[];
  household?: Household | null;
  householdMembers?: Person[];
  onEdit?: () => void;
}

const COMMITMENT_TYPE_LABELS = {
  core_group: "Core Group",
  launch_team: "Launch Team",
} as const;

const SOURCE_LABELS: Record<string, string> = {
  personal_referral: "Personal Referral",
  social_media: "Social Media",
  vision_meeting: "Vision Meeting",
  website: "Website",
  event: "Event",
  partner_church: "Partner Church",
  other: "Other",
};

export function PersonOverview({
  person,
  tags = [],
  availableTags = [],
  latestCommitment,
  skills = [],
  household,
  householdMembers = [],
  onEdit,
}: PersonOverviewProps) {
  const router = useRouter();

  const fullAddress = [
    person.addressLine1,
    person.addressLine2,
    [person.city, person.state].filter(Boolean).join(", "),
    person.postalCode,
    person.country !== "US" ? person.country : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      {/* All Personal Information — unified card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold">
            All Personal Information
          </CardTitle>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Email */}
            <div className="flex items-start gap-3">
              <Mail className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Mail Address
                </p>
                {person.email ? (
                  <a
                    href={`mailto:${person.email}`}
                    className="text-primary text-sm hover:underline"
                  >
                    {person.email}
                  </a>
                ) : (
                  <p className="text-muted-foreground text-sm">Not provided</p>
                )}
              </div>
            </div>

            {/* Phone */}
            <div className="flex items-start gap-3">
              <Phone className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Phone Number
                </p>
                {person.phone ? (
                  <a
                    href={`tel:${person.phone}`}
                    className="text-primary text-sm hover:underline"
                  >
                    {person.phone}
                  </a>
                ) : (
                  <p className="text-muted-foreground text-sm">Not provided</p>
                )}
              </div>
            </div>

            {/* Source */}
            <div className="flex items-start gap-3">
              <TagIcon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Source
                </p>
                <p className="text-sm">
                  {person.source
                    ? (SOURCE_LABELS[person.source] ?? person.source)
                    : "Unknown"}
                  {person.sourceDetails && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({person.sourceDetails})
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Address */}
            <div className="flex items-start gap-3">
              <MapPin className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Address
                </p>
                {fullAddress ? (
                  <p className="text-sm">{fullAddress}</p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No address provided
                  </p>
                )}
              </div>
            </div>

            {/* Added date */}
            <div className="flex items-start gap-3">
              <Calendar className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Added
                </p>
                <p className="text-sm">
                  {person.createdAt
                    ? format(new Date(person.createdAt), "MMM d, yyyy")
                    : "Unknown"}
                </p>
              </div>
            </div>
          </div>

          {/* Notes (inline, below the grid) */}
          {person.notes && (
            <>
              <Separator className="my-6" />
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Notes
                </p>
                <p className="text-sm whitespace-pre-wrap">{person.notes}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Family Members */}
      <HouseholdMembers
        person={person}
        household={household ?? null}
        members={householdMembers}
      />

      {/* Commitment */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold">Commitment</CardTitle>
          <FileSignature className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          {latestCommitment ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {COMMITMENT_TYPE_LABELS[latestCommitment.commitmentType]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  Signed{" "}
                  {format(new Date(latestCommitment.signedDate), "MMM d, yyyy")}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/people/${person.id}/assessments?tab=commitments`}>
                  View All
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                No commitment recorded yet
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/people/${person.id}/assessments/commitment`}>
                  <Plus className="mr-1 h-3 w-3" />
                  Record Commitment
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tags */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold">Tags</CardTitle>
          <TagIcon className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <TagPicker
            personId={person.id}
            selectedTags={tags}
            availableTags={availableTags}
            onTagsChange={() => router.refresh()}
          />
        </CardContent>
      </Card>

      {/* Skills & Gifts */}
      <SkillsList personId={person.id} skills={skills} />
    </div>
  );
}
