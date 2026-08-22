"use server";

// THROWAWAY — #665's bisect rig. Deleted before this branch merges.

import { refresh } from "next/cache";

export interface ProbeOutcome {
  ok: true;
  stamp: string;
}

/** The control: returns state, streams no tree patch. */
export async function probeWithoutRefresh(): Promise<ProbeOutcome> {
  return { ok: true, stamp: new Date().toISOString() };
}

/** The same, plus the tree patch `refresh()` streams into the response. */
export async function probeWithRefresh(): Promise<ProbeOutcome> {
  refresh();
  return { ok: true, stamp: new Date().toISOString() };
}
