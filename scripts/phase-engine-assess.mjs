#!/usr/bin/env node

// The scheduler reports transport and assessment success separately. Print only
// validated counts: outcome errors and error response bodies can contain secrets.
const countFields = [
  "selected",
  "attempted",
  "assessed",
  "failed",
  "skipped",
  "deferred",
  "deferredUnattempted",
  "rateLimited",
  "schemaRejected",
  "schemaRetried",
];

function readSummary(value) {
  if (!value || typeof value !== "object" || value.ok !== true) return null;
  const counts = {};
  for (const field of countFields) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) return null;
    counts[field] = value[field];
  }
  if (
    counts.selected !==
      counts.assessed + counts.failed + counts.skipped + counts.deferred ||
    counts.attempted !==
      counts.assessed +
        counts.failed +
        counts.deferred -
        counts.deferredUnattempted ||
    counts.deferredUnattempted > counts.deferred ||
    counts.rateLimited > counts.deferred ||
    counts.schemaRejected > counts.failed
  )
    return null;
  return counts;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

async function main() {
  const { CRON_SECRET, ASSESS_URL } = process.env;
  if (!CRON_SECRET)
    return fail(
      "CRON_SECRET is not set. The assessment run cannot authenticate."
    );
  if (!ASSESS_URL)
    return fail("ASSESS_URL is not set. No assessment request was sent.");
  let response;
  try {
    response = await fetch(ASSESS_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      redirect: "error",
      signal: AbortSignal.timeout(320_000),
    });
  } catch {
    return fail(
      "No HTTP response: the assessment request failed or timed out."
    );
  }
  console.log(`HTTP ${response.status}`);
  if (!response.ok)
    return fail(
      `Assessment request failed with HTTP ${response.status}. Check service availability and cron authentication.`
    );
  let summary;
  try {
    summary = readSummary(await response.json());
  } catch {
    return fail("Assessment response is not a valid JSON summary.");
  }
  if (!summary)
    return fail("Assessment response is missing valid, consistent run counts.");
  console.log(`Assessment counts: ${JSON.stringify(summary)}`);
  if (summary.failed > 0)
    return fail(
      "Assessment run reported failures. Inspect the assessment service; failed plants retain their last good snapshot and remain eligible for a later tick."
    );
  console.log(
    "Assessment run completed without failures. Skipped and deferred plants remain eligible for a later tick."
  );
}

await main();
