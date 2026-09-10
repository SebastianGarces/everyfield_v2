import Link from "next/link";

import { Button } from "@/components/ui/button";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import { wikiHref } from "@/lib/wiki/href";

// Guidance follows the Launch Playbook's phase sequence. Article slugs are
// shared with the wiki corpus; the links are reads available to every seat.
export const ACTIVITY_GUIDANCE = {
  0: {
    description:
      "Explore the planting journey before building your core group.",
    article: "getting-started/welcome-to-the-launch-playbook",
    label: "Read the Launch Playbook introduction",
    action: "people",
  },
  1: {
    description:
      "Core group development starts with relationships and follow-up.",
    article: "core-group/building-your-core-group/the-core-group-funnel",
    label: "Read about building your core group",
    action: "people",
  },
  2: {
    description:
      "As the core group becomes a launch team, meetings focus on preparing to launch.",
    article: "launch-team/launch-date/transitioning-to-launch-team",
    label: "Read about forming your launch team",
    action: "meetings",
  },
  3: {
    description: "Training helps the launch team prepare for serving together.",
    article: "training/training-programs-overview",
    label: "Read the training guide",
    action: "meetings",
  },
  4: {
    description:
      "Final preparations bring the team's plans and responsibilities together.",
    article: "pre-launch/final-checklist-review",
    label: "Read the pre-launch checklist",
    action: "meetings",
  },
  5: {
    description:
      "Launch Sunday brings the team's preparation and guest welcome together.",
    article: "launch-sunday/launch-day-guide",
    label: "Read the Launch Sunday guide",
    action: "people",
  },
  6: {
    description:
      "After launch, consistent follow-up helps guests become connected.",
    article: "post-launch/the-guest-assimilation-journey",
    label: "Read the guest assimilation guide",
    action: "people",
  },
} as const satisfies Record<
  PhaseNumber,
  {
    description: string;
    article: string;
    label: string;
    action: "people" | "meetings";
  }
>;

const FIRST_ACTIONS = {
  people: {
    capability: "people.write",
    href: "/people/new",
    label: "Add a person",
  },
  meetings: {
    capability: "meetings.write",
    href: "/meetings/new",
    label: "Schedule a meeting",
  },
} as const;

export function ActivityGuidance({
  viewer,
  phase,
}: {
  viewer: SeatFields;
  phase: PhaseNumber;
}) {
  const guidance = ACTIVITY_GUIDANCE[phase];
  const action = FIRST_ACTIONS[guidance.action];

  return (
    <div className="mt-4 max-w-md space-y-3 text-sm">
      <p className="font-medium">{PHASES[phase]}</p>
      <p className="text-muted-foreground">{guidance.description}</p>
      <p>
        <Link href={wikiHref(guidance.article)}>{guidance.label}</Link>
      </p>
      {holdsSeatFor(viewer, action.capability) && (
        <Button asChild variant="outline">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
