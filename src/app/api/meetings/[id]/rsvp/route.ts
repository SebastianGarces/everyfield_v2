import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { holdsSeatFor, SeatRefusalError } from "@/lib/auth/seat-rules";
import { ownRsvpInput } from "@/lib/meetings/own-rsvp-input";
import { saveOwnRsvp } from "@/lib/meetings/own-rsvp";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // HTTP routes return explicit status codes; server actions throw their
    // session refusal. The capability and subject policies are shared.
    const { user } = await getCurrentSession();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in again to save your RSVP." },
        { status: 401 }
      );
    }
    if (!holdsSeatFor(user, "meetings.rsvp")) {
      return NextResponse.json(
        { error: "Your account cannot update this RSVP." },
        { status: 403 }
      );
    }
    const id = z
      .string()
      .uuid()
      .safeParse((await context.params).id);
    const input = ownRsvpInput.safeParse(await req.json().catch(() => null));
    if (!id.success || !input.success) {
      return NextResponse.json(
        { error: "Choose confirm or decline." },
        { status: 400 }
      );
    }
    if (!(await saveOwnRsvp(user, id.data, input.data.response))) {
      return NextResponse.json(
        { error: "Your invitation is unavailable. Reload the meeting." },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SeatRefusalError) {
      return NextResponse.json(
        { error: "Your account cannot update this RSVP." },
        { status: 403 }
      );
    }
    console.error("[Own RSVP] Save failed", error);
    return NextResponse.json(
      { error: "Unable to save your RSVP. Please try again." },
      { status: 500 }
    );
  }
}
