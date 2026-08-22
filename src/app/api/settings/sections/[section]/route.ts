import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { loadSettingsSection } from "@/lib/settings/section-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/sections/<section>
 *
 * THE SETTINGS MODAL'S ONLY READ (#657, ruled 2026-08-22).
 *
 * Settings is client state addressed by a fragment, so no route renders a
 * section and the section bodies are `"use client"`. This is where their values
 * come from: the browser asks for the section the fragment names and gets that
 * section's finished view model, resolved and gate-checked by
 * `loadSettingsSection`.
 *
 * A ROUTE HANDLER RATHER THAN A SERVER ACTION, and the difference is the whole
 * reason this file exists. Every server-action response carries a fresh RSC
 * render of the current route — that is how `refresh()` delivers an update —
 * which regenerates the `serverRenderId` prop the modal re-reads on. So as an
 * action, this read RE-TRIGGERED ITSELF: measured on the preview, one
 * notification toggle produced an unbounded loop at about seven requests a
 * second. A route handler answers with JSON and re-renders nothing, so the
 * chain terminates and a write costs exactly one extra read.
 *
 * NO SESSION IS 401 AND NOTHING ELSE. Everything past that — a section this
 * account may not open, a body whose own gate refuses it, a plant that is not
 * there — is `{ ok: false }` with a 200, because it is an ANSWER rather than an
 * error: the modal corrects the fragment to the default section, which is what
 * the deleted `/settings/*` routes did with a redirect. A 403 here would make a
 * reader's ordinary mistake (a stale bookmark, a seat that changed under them)
 * look like a failure in the console.
 *
 * IT READS AND IT WRITES NOTHING. The refusal that matters is each action's
 * `requireSeat`, on every write behind these controls; this decides only what
 * renders.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ section: string }> }
) {
  const { user } = await getCurrentSession();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { section } = await params;
  return NextResponse.json(await loadSettingsSection(section), {
    // The answer is this account's, right now. A shared cache holding one
    // reader's Team roster for another is the one failure this endpoint could
    // have that nothing on screen would show.
    headers: { "cache-control": "private, no-store" },
  });
}
