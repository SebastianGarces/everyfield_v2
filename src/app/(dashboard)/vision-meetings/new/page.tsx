import { HeaderBreadcrumbs } from "@/components/header";
import { MeetingForm } from "@/components/vision-meetings/meeting-form";
import { verifySession } from "@/lib/auth/session";
import { listLocations } from "@/lib/vision-meetings/locations";
import { redirect } from "next/navigation";

export default async function NewMeetingPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const locations = await listLocations(user.churchId);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Vision Meetings", href: "/vision-meetings" },
          { label: "Schedule Meeting" },
        ]}
      />
      <div className="mx-auto max-w-2xl p-6">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Schedule Vision Meeting
            </h1>
            <p className="text-muted-foreground mt-1">
              Set a date, time, and location for your next Vision Meeting.
            </p>
          </div>
          <MeetingForm locations={locations} />
        </div>
      </div>
    </>
  );
}
