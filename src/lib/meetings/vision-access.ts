import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { churchMeetings } from "@/db/schema/meetings";
import { hasVisionFeature, type VisionFeature } from "./vision-features";

export async function requireVisionFeature(
  churchId: string,
  meetingId: string,
  feature: VisionFeature
): Promise<void> {
  const [meeting] = await db
    .select({ type: churchMeetings.type, status: churchMeetings.status })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .limit(1);
  if (!meeting || !hasVisionFeature(meeting, feature)) {
    throw new Error("Meeting feature unavailable");
  }
}
