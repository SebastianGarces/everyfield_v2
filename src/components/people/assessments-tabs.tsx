"use client";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Assessment, Commitment, Interview } from "@/db/schema";
import { ClipboardList, FileSignature, Plus, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AssessmentHistory } from "./assessment-history";
import { CommitmentHistory } from "./commitment-history";
import { InterviewHistory } from "./interview-history";

interface AssessmentsTabsProps {
  personId: string;
  assessments: Assessment[];
  interviews: Interview[];
  commitments: Commitment[];
}

export function AssessmentsTabs({
  personId,
  assessments,
  interviews,
  commitments,
}: AssessmentsTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "interviews";

  const handleTabChange = (value: string) => {
    router.push(`/people/${personId}/assessments?tab=${value}`, {
      scroll: false,
    });
  };

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className="flex-1">
      <TabsList>
        <TabsTrigger value="interviews">
          Interviews
          {interviews.length > 0 && (
            <span className="bg-foreground/10 ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
              {interviews.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="commitments">
          Commitments
          {commitments.length > 0 && (
            <span className="bg-foreground/10 ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
              {commitments.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="assessments">
          4 C&apos;s Assessment
          {assessments.length > 0 && (
            <span className="bg-foreground/10 ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
              {assessments.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="interviews" className="mt-6 space-y-6">
        <div className="bg-card flex items-center justify-between rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">Member Interviews</h2>
            <p className="text-muted-foreground text-sm">
              Evaluate Maturity, Gifted, Chemistry, Right Reasons, and Season of
              Life
            </p>
          </div>
          <Button asChild>
            <Link href={`/people/${personId}/assessments/interview`}>
              <Plus className="mr-2 h-4 w-4" />
              New Interview
            </Link>
          </Button>
        </div>

        {interviews.length > 0 ? (
          <InterviewHistory interviews={interviews} />
        ) : (
          <div className="bg-card flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
            <UserCheck className="text-muted-foreground/50 h-12 w-12" />
            <h3 className="mt-4 font-semibold">No interviews yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Conduct an interview to evaluate this person&apos;s readiness.
            </p>
            <Button asChild className="mt-4">
              <Link href={`/people/${personId}/assessments/interview`}>
                <Plus className="mr-2 h-4 w-4" />
                Start First Interview
              </Link>
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="commitments" className="mt-6 space-y-6">
        <div className="bg-card flex items-center justify-between rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">Commitments</h2>
            <p className="text-muted-foreground text-sm">
              Record signed commitment cards for Core Group and Launch Team
            </p>
          </div>
          <Button asChild>
            <Link href={`/people/${personId}/assessments/commitment`}>
              <Plus className="mr-2 h-4 w-4" />
              Record Commitment
            </Link>
          </Button>
        </div>

        {commitments.length > 0 ? (
          <CommitmentHistory commitments={commitments} />
        ) : (
          <div className="bg-card flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
            <FileSignature className="text-muted-foreground/50 h-12 w-12" />
            <h3 className="mt-4 font-semibold">No commitments yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Record a commitment when this person signs their commitment
              card.
            </p>
            <Button asChild className="mt-4">
              <Link href={`/people/${personId}/assessments/commitment`}>
                <Plus className="mr-2 h-4 w-4" />
                Record First Commitment
              </Link>
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="assessments" className="mt-6 space-y-6">
        <div className="bg-card flex items-center justify-between rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">4 C&apos;s Assessments</h2>
            <p className="text-muted-foreground text-sm">
              Track Committed, Compelled, Contagious, and Courageous qualities
            </p>
          </div>
          <Button asChild>
            <Link href={`/people/${personId}/assessments/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New Assessment
            </Link>
          </Button>
        </div>

        {assessments.length > 0 ? (
          <AssessmentHistory assessments={assessments} />
        ) : (
          <div className="bg-card flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
            <ClipboardList className="text-muted-foreground/50 h-12 w-12" />
            <h3 className="mt-4 font-semibold">No assessments yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Start a 4 C&apos;s assessment to track this person&apos;s
              growth.
            </p>
            <Button asChild className="mt-4">
              <Link href={`/people/${personId}/assessments/new`}>
                <Plus className="mr-2 h-4 w-4" />
                Start First Assessment
              </Link>
            </Button>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
