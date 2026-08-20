import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  PERSON_PHOTO_MAX_BYTES,
  PERSON_PHOTO_MIME_TYPES,
  personPhotoRefusal,
  personPhotoSrc,
} from "./photo";

// ----------------------------------------------------------------------------
// WHAT A PERSON PHOTO MAY BE, AND WHO SAYS SO (#320, P-024a).
//
// The size limit is not a taste decision. A server action's payload is one
// request body, and two caps sit over it: Next's own `serverActions
// .bodySizeLimit`, which defaults to 1MB, and the serverless platform's 4.5MB,
// which nothing in this repo can raise. Measured on the preview: a 6MB upload
// came back as a bare `413` plus "An unexpected response was received from the
// server" in the console — the action never ran, so the sentence it would have
// returned never existed.
//
// So three things have to agree, and the last test is what keeps them agreeing:
// the promised limit < Next's configured bound < the platform's cap.
// ----------------------------------------------------------------------------

const ok = { type: "image/png", size: 200_000 };

test("an image inside the limit is accepted", () => {
  assert.equal(personPhotoRefusal(ok), null);
  for (const type of PERSON_PHOTO_MIME_TYPES) {
    assert.equal(personPhotoRefusal({ type, size: 1000 }), null, type);
  }
});

test("a non-image is refused by type, whatever its size", () => {
  assert.equal(
    personPhotoRefusal({ type: "application/pdf", size: 100 }),
    "That file is not an image. Use a JPG, PNG or WebP."
  );
  assert.equal(
    personPhotoRefusal({ type: "text/html", size: 10 }),
    "That file is not an image. Use a JPG, PNG or WebP."
  );
});

test("an oversized image is refused by size, and named as such", () => {
  assert.equal(
    personPhotoRefusal({ type: "image/png", size: PERSON_PHOTO_MAX_BYTES + 1 }),
    "That image is too large. The limit is 3MB."
  );
  assert.equal(
    personPhotoRefusal({ type: "image/png", size: PERSON_PHOTO_MAX_BYTES }),
    null,
    "the limit itself is allowed"
  );
});

test("an empty file is not a photo", () => {
  assert.equal(
    personPhotoRefusal({ type: "image/png", size: 0 }),
    "That file is not an image. Use a JPG, PNG or WebP."
  );
});

test("the refusal message names the limit it enforces", () => {
  const message = personPhotoRefusal({
    type: "image/png",
    size: PERSON_PHOTO_MAX_BYTES + 1,
  });
  const mb = PERSON_PHOTO_MAX_BYTES / (1024 * 1024);
  assert.ok(
    message?.includes(`${mb}MB`),
    `the message must say ${mb}MB, not: ${message}`
  );
});

test("the promised limit fits inside the body caps above it", () => {
  const config = readFileSync(
    path.join(process.cwd(), "next.config.ts"),
    "utf8"
  );
  const declared = config.match(/bodySizeLimit:\s*"(\d+(?:\.\d+)?)mb"/);
  assert.ok(
    declared,
    "next.config.ts must declare serverActions.bodySizeLimit — the 1MB default " +
      "turns a 2MB avatar into a 413 the action never sees"
  );

  const nextLimitBytes = Number(declared[1]) * 1024 * 1024;
  const PLATFORM_BODY_CAP = 4.5 * 1024 * 1024; // Vercel; not raisable from here

  assert.ok(
    PERSON_PHOTO_MAX_BYTES < nextLimitBytes,
    "a file at the promised limit must reach the action, or the refusal is a 413"
  );
  assert.ok(
    nextLimitBytes <= PLATFORM_BODY_CAP,
    "raising Next's bound past the platform's buys nothing but a worse error"
  );
});

test("a person with no photo has no src at all — the initials fallback renders", () => {
  assert.equal(personPhotoSrc("person-1", null), undefined);
  assert.equal(personPhotoSrc("person-1", undefined), undefined);
  assert.equal(personPhotoSrc("person-1", ""), undefined);
});

test("the photo src is the app route, never a key or a bucket URL", () => {
  const key = "people/church-1/person-1/abc-123.png";
  const src = personPhotoSrc("person-1", key);

  assert.ok(src, "a stored key must resolve to a route");
  assert.ok(src.startsWith("/api/people/person-1/photo?v="));
  assert.ok(
    !src.includes("church-1"),
    "the key must not ride to the browser — the route resolves it server-side"
  );

  // The uuid is the cache buster: without it the browser keeps the old avatar
  // after a replacement, because the route's address does not change.
  assert.notEqual(
    personPhotoSrc("person-1", "people/church-1/person-1/def-456.png"),
    src
  );
});
