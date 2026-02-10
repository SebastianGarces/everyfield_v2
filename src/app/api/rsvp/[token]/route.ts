import { NextRequest, NextResponse } from "next/server";
import { resolveConfirmation } from "@/lib/communication/confirmation";

/**
 * Public API endpoint for meeting RSVP confirmation/decline.
 * No authentication required — token-based access.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await req.json();
    const response = body.response;

    if (response !== "confirmed" && response !== "declined") {
      return NextResponse.json(
        { success: false, error: "Invalid response. Must be 'confirmed' or 'declined'." },
        { status: 400 }
      );
    }

    const result = await resolveConfirmation(token, response);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[RSVP] Error:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
