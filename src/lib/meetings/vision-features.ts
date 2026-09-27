import type { MeetingType } from "@/db/schema/meetings";

export type VisionFeature = "outcomes" | "evaluation" | "logistics";

/** Response cards can arrive during the meeting; evaluation follows completion. */
export function hasVisionFeature(
  meeting: { type: MeetingType; status: string },
  feature: VisionFeature
): boolean {
  return (
    meeting.type === "vision_meeting" &&
    (feature !== "evaluation" || meeting.status === "completed")
  );
}
