import { createHash } from "node:crypto";

export const FIXTURE_NOW = new Date("2026-09-20T16:00:00.000Z");
export const FIXTURE_ZONE = "America/New_York";
export const fixtureSymbols = [
  "plant",
  "foreign-plant",
  "actor",
  "other-actor",
  "foreign-actor",
  "task-today",
  "task-today-medium",
  "task-overdue",
  "task-tomorrow",
  "task-complete",
  "task-undated",
  "task-other-actor",
  "task-foreign",
  "prospect-followed",
  "prospect-new",
  "prospect-interviewed",
  "prospect-attended",
  "prospect-rsvp-only",
  "person-foreign",
  "core-alex",
  "core-jordan",
  "church-location",
  "orientation-template",
  "meeting-one",
  "meeting-two",
  "meeting-upcoming",
  "launch",
  "milestone-open",
  "milestone-complete",
  "ministry",
  "open-role",
  "second-ministry",
  "second-open-role",
  "occupied-role",
  "inactive-assignment",
  "active-assignment",
  "wiki-vision",
  "wiki-orientation",
  "wiki-global",
  "wiki-foreign",
  "wiki-draft",
] as const;
export type FixtureSymbol = (typeof fixtureSymbols)[number];
export function fixtureId(caseId: string, symbol: string): string {
  const hex = createHash("sha256")
    .update(`evry-eve-fixture-v1:${caseId}:${symbol}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function createFixtureManifest(
  caseId: string,
  repetition: number,
  now = FIXTURE_NOW
) {
  const namespace = `${caseId}:${repetition}`;
  const ids = Object.fromEntries(
    fixtureSymbols.map((symbol) => [symbol, fixtureId(namespace, symbol)])
  ) as Record<FixtureSymbol, string>;
  const sessionToken = `${namespace}:session`;
  const sessionId = createHash("sha256").update(sessionToken).digest("hex");
  const payload = {
    version: 1,
    caseId,
    repetition,
    now: now.toISOString(),
    timeZone: FIXTURE_ZONE,
    ids,
  };
  return {
    ...payload,
    sessionToken,
    sessionId,
    digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}
export type FixtureManifest = ReturnType<typeof createFixtureManifest>;
