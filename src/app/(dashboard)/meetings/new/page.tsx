import { redirect } from "next/navigation";
import { HeaderBreadcrumbs } from "@/components/header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AiVisionMeetingPlanner } from "@/components/meetings/ai-vision-meeting-planner";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { verifySession } from "@/lib/auth/session";
import { listLocations } from "@/lib/meetings/locations";
import { listTeams } from "@/lib/ministry-teams/service";
import type { MeetingType } from "@/db/schema";

interface NewMeetingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NewMeetingPage({
  searchParams,
}: NewMeetingPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const defaultType = (params.type as MeetingType) || undefined;
  const defaultTeamId = params.teamId as string | undefined;
  const aiPlannerEnabled = Boolean(process.env.OPENROUTER_API_KEY);
  const supportsAiPlanner =
    defaultType === undefined || defaultType === "vision_meeting";
  const showAiPlanner = aiPlannerEnabled && supportsAiPlanner;

  const [locations, teams] = await Promise.all([
    listLocations(user.churchId),
    listTeams(user.churchId),
  ]);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: "Schedule Meeting" },
        ]}
      />
      <div
        className={`mx-auto p-6 ${showAiPlanner ? "max-w-6xl" : "max-w-2xl"}`}
      >
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Schedule Meeting
            </h1>
            <p className="text-muted-foreground mt-1">
              Set a date, time, and location for your next meeting.
            </p>
          </div>
          {!aiPlannerEnabled && supportsAiPlanner ? (
            <Alert className="border-yellow-500/50 bg-yellow-50">
              <AlertTitle className="text-yellow-900">
                AI planner not configured
              </AlertTitle>
              <AlertDescription className="text-yellow-800">
                Set <code>OPENROUTER_API_KEY</code> in your local environment to
                enable the AI vision meeting planner. The manual form is still
                available below.
              </AlertDescription>
            </Alert>
          ) : null}
          {showAiPlanner ? (
            <Tabs defaultValue="ai" className="w-full">
              <TabsList>
                <TabsTrigger value="ai" className="cursor-pointer">
                  AI Planner
                </TabsTrigger>
                <TabsTrigger value="manual" className="cursor-pointer">
                  Manual Form
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ai" className="pt-2">
                <AiVisionMeetingPlanner />
              </TabsContent>
              <TabsContent value="manual" className="pt-2">
                <MeetingForm
                  locations={locations}
                  teams={teams}
                  defaultType={defaultType}
                  defaultTeamId={defaultTeamId}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <MeetingForm
              locations={locations}
              teams={teams}
              defaultType={defaultType}
              defaultTeamId={defaultTeamId}
            />
          )}
        </div>
      </div>
    </>
  );
}
