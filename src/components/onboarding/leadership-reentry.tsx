"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  leadershipAnswerForStatus,
  type ChurchLeadershipStatus,
} from "@/lib/onboarding/leadership";
import { LeadershipStep } from "./leadership-step";

/**
 * F12 / OB-004 — the leadership step on its own, reached from the dashboard's
 * no-planter nudge.
 *
 * Deliberately NOT "re-open the wizard". Leaving onboarding is one-way (ruling
 * 2026-07-31); the no-planter case is the one specced exception, and it is an
 * exception for a single question, so it re-enters as a single card. The
 * question, its consequences and the write are the same component the flow
 * uses — there is one leadership form in this codebase, not two that can drift.
 */
export function LeadershipReentry({
  leadershipStatus,
}: {
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Leadership</CardTitle>
          <CardDescription>
            Who is leading this plant. Change this whenever it changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadershipStep
            initialAnswer={leadershipAnswerForStatus(leadershipStatus)}
            submitLabel="Save"
            onSaved={() => router.replace("/dashboard")}
            secondary={
              <Button
                asChild
                variant="ghost"
                className="cursor-pointer"
                type="button"
              >
                <Link href="/dashboard">Back to dashboard</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
