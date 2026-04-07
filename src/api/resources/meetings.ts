import { and, eq } from "drizzle-orm";
import { churchMeetings } from "@/db/schema/meetings";
import { createMeeting } from "@/lib/meetings/service";
import {
  meetingCreateApiSchema,
  type MeetingCreateInput,
} from "@/lib/validations/meetings";

export const meetingsResource = {
  path: "meetings",
  table: churchMeetings,
  options: {
    requireSession: true,
    createSchema: meetingCreateApiSchema,
    listWhere: ({ churchId }: { churchId: string }) =>
      eq(churchMeetings.churchId, churchId),
    getWhere: ({ churchId }: { churchId: string }, id?: string) =>
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, id ?? "")
      ),
    createHandler: (
      { churchId, user }: { churchId: string; user: { id: string } },
      input: unknown
    ) => createMeeting(churchId, user.id, input as MeetingCreateInput),
  },
} as const;
