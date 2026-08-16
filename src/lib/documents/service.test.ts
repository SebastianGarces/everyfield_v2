import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { generatedDocumentFormats } from "@/db/schema/documents";
import { codeOf, isUseServerModule } from "@/lib/auth/server-action-surface";
import { FORMAT_OUTPUT, type DocumentFormat } from "@/lib/documents/types";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

import {
  GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN,
  generatedDocumentFilename,
  generatedDocumentForChurchQuery,
  generatedDocumentRow,
  generatedDocumentsForChurchQuery,
  generatedDocumentStorageKey,
  insertGeneratedDocumentQuery,
  toGeneratedDocumentListItem,
} from "./service";

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARTIFACT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SRC = path.join(process.cwd(), "src");
const migrationSource = readFileSync(
  path.join(SRC, "db", "migrations", "0046_generated_documents.sql"),
  "utf8"
);
const serviceSource = readFileSync(
  path.join(SRC, "lib", "documents", "service.ts"),
  "utf8"
);
const routeSource = readFileSync(
  path.join(SRC, "app", "api", "documents", "[templateId]", "route.ts"),
  "utf8"
);
const actionSource = readFileSync(
  path.join(SRC, "app", "(dashboard)", "documents", "actions.ts"),
  "utf8"
);
const pageSource = readFileSync(
  path.join(SRC, "app", "(dashboard)", "documents", "history", "page.tsx"),
  "utf8"
);

const service = sourceReader(serviceSource, "service.ts");
const recordBody = service.after(
  "export async function recordGeneratedDocument"
);

// ============================================================================
// Insert shape and key convention
// ============================================================================

test("the storage key is church-scoped documents/{churchId}/{uuid}.{ext}", () => {
  assert.equal(
    generatedDocumentStorageKey(CHURCH_A, ARTIFACT_ID, "pdf"),
    `documents/${CHURCH_A}/${ARTIFACT_ID}.pdf`
  );
  assert.equal(
    generatedDocumentStorageKey(CHURCH_B, ARTIFACT_ID, "xlsx"),
    `documents/${CHURCH_B}/${ARTIFACT_ID}.xlsx`
  );
});

test("the insert row carries template id, format, church id, user id and storage key", () => {
  const row = generatedDocumentRow({
    id: ARTIFACT_ID,
    churchId: CHURCH_A,
    userId: USER_A,
    templateId: "commitment-card",
    format: "pdf",
  });

  assert.equal(row.id, ARTIFACT_ID);
  assert.equal(row.templateId, "commitment-card");
  assert.equal(row.format, "pdf");
  assert.equal(row.churchId, CHURCH_A);
  assert.equal(row.userId, USER_A);
  assert.equal(row.storageKey, `documents/${CHURCH_A}/${ARTIFACT_ID}.pdf`);
});

test("the insert SQL names every required column and binds the caller's church", () => {
  const row = generatedDocumentRow({
    id: ARTIFACT_ID,
    churchId: CHURCH_A,
    userId: USER_A,
    templateId: "first-year-budget",
    format: "xlsx",
  });
  const { sql: text, params } = insertGeneratedDocumentQuery(row).toSQL();

  assert.match(text, /insert into "generated_documents"/i);
  assert.match(text, /"template_id"/);
  assert.match(text, /"format"/);
  assert.match(text, /"church_id"/);
  assert.match(text, /"user_id"/);
  assert.match(text, /"storage_key"/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER_A));
  assert.ok(params.includes("first-year-budget"));
  assert.ok(params.includes("xlsx"));
  assert.ok(params.includes(`documents/${CHURCH_A}/${ARTIFACT_ID}.xlsx`));
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the insert"
  );
});

test("the format CHECK tuple matches the catalog's DocumentFormat keys", () => {
  assert.deepEqual(
    [...generatedDocumentFormats].sort(),
    (Object.keys(FORMAT_OUTPUT) as DocumentFormat[]).slice().sort()
  );
});

test("the migration creates generated_documents once, with church_id NOT NULL", () => {
  const creates = migrationSource.match(/CREATE TABLE "generated_documents"/g);
  assert.equal(creates?.length, 1);
  assert.match(migrationSource, /"church_id" uuid NOT NULL/);
  assert.match(
    migrationSource,
    /CONSTRAINT "generated_documents_format_check"/
  );
});

// ============================================================================
// List tenancy — newest first, this church only
// ============================================================================

test("the list query scopes church_id and orders newest first", () => {
  const { sql: text, params } =
    generatedDocumentsForChurchQuery(CHURCH_A).toSQL();

  assert.match(text, /"generated_documents"\."church_id" = \$\d/);
  assert.match(text, /order by "generated_documents"\."created_at" desc/i);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(!params.includes(CHURCH_B), "another church's id reached the list");
});

test("a list for church A cannot be satisfied by church B's id", () => {
  const forA = generatedDocumentsForChurchQuery(CHURCH_A).toSQL();
  const forB = generatedDocumentsForChurchQuery(CHURCH_B).toSQL();

  assert.ok(forA.params.includes(CHURCH_A));
  assert.ok(!forA.params.includes(CHURCH_B));
  assert.ok(forB.params.includes(CHURCH_B));
  assert.ok(!forB.params.includes(CHURCH_A));
});

test("list items expose no storage key — the client never sees one", () => {
  const item = toGeneratedDocumentListItem({
    id: ARTIFACT_ID,
    churchId: CHURCH_A,
    userId: USER_A,
    templateId: "commitment-card",
    format: "pdf",
    storageKey: `documents/${CHURCH_A}/${ARTIFACT_ID}.pdf`,
    createdAt: new Date("2026-01-20T00:00:00.000Z"),
  });

  assert.equal(item.id, ARTIFACT_ID);
  assert.equal(item.templateId, "commitment-card");
  assert.equal(item.templateName, "Core Group Commitment Card");
  assert.equal(item.format, "pdf");
  assert.equal(item.filename, "commitment-card.pdf");
  assert.equal("storageKey" in item, false);
  assert.equal("churchId" in item, false);
});

test("the download filename is the template id plus extension, never a storage key", () => {
  assert.equal(
    generatedDocumentFilename("commitment-card", "pdf"),
    "commitment-card.pdf"
  );
  assert.equal(
    generatedDocumentFilename("first-year-budget", "xlsx"),
    "first-year-budget.xlsx"
  );
  assert.doesNotMatch(
    generatedDocumentFilename("commitment-card", "pdf"),
    /documents\//
  );
});

// ============================================================================
// Signed URL — church re-check, never a client-supplied key
// ============================================================================

test("the signed-URL lookup requires id AND church_id", () => {
  const { sql: text, params } = generatedDocumentForChurchQuery(
    CHURCH_A,
    ARTIFACT_ID
  ).toSQL();

  assert.match(text, /"generated_documents"\."id" = \$\d/);
  assert.match(text, /"generated_documents"\."church_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(ARTIFACT_ID));
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the signed-URL lookup"
  );
  assert.doesNotMatch(
    text,
    /where[\s\S]*storage_key/i,
    "lookup is by id and church, never by a guessed object key"
  );
  assert.equal(
    params.some((value) => String(value).startsWith("documents/")),
    false,
    "a storage key must not be a bind parameter of the signed-URL lookup"
  );
});

test("a foreign church looking up the same uuid binds its own church_id, not the owner's", () => {
  const { params } = generatedDocumentForChurchQuery(
    CHURCH_B,
    ARTIFACT_ID
  ).toSQL();

  assert.ok(params.includes(CHURCH_B));
  assert.ok(params.includes(ARTIFACT_ID));
  assert.ok(!params.includes(CHURCH_A));
});

test("the download URL signs the row's storage key after the church-scoped lookup", () => {
  const downloadBody = service.span(
    "export async function getGeneratedDocumentDownloadUrl",
    "export async function recordGeneratedDocument"
  );

  assertInOrder(
    downloadBody,
    "getGeneratedDocumentDownloadUrl",
    [
      "const row = await getGeneratedDocument(churchId, id);",
      "if (!row) return null;",
      "return getSignedDownloadUrl(",
      "row.storageKey,",
      "generatedDocumentFilename(row.templateId, row.format)",
      "GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN",
    ],
    "a missing or foreign row must not be signed; the key comes from the row, never the client"
  );
  assert.equal(GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN, 3600);
});

test("the action never accepts a storage key — only an artifact id", () => {
  assert.match(actionSource, /z\.strictObject\(\{/);
  assert.match(actionSource, /id:\s*z\.uuid\(\)/);
  assert.doesNotMatch(actionSource, /storageKey/);
  assert.doesNotMatch(actionSource, /storage_key/);
});

test("the action mints the session before it parses, above the try", () => {
  const action = sourceReader(actionSource, "documents/actions.ts");
  const body = action.span(
    "export async function getGeneratedDocumentDownloadUrlAction",
    "export type GeneratedDocumentDownloadResult"
  );

  assertInOrder(
    body,
    "getGeneratedDocumentDownloadUrlAction",
    ["await verifySession();", "safeParse", "try {"],
    "session first, then parse, mint above the try"
  );
});

test("the action re-checks church_id from the session, not a client church id", () => {
  assert.match(
    actionSource,
    /getGeneratedDocumentDownloadUrl\(\s*user\.churchId/
  );
  assert.doesNotMatch(actionSource, /churchId:\s*z/);
});

test("the documents action module is a use-server endpoint", () => {
  const full = path.join(SRC, "app", "(dashboard)", "documents", "actions.ts");
  assert.equal(isUseServerModule(full), true);
  assert.match(codeOf(full), /verifySession/);
});

// ============================================================================
// Storage failure must not leave a history row pointing at a missing object
// ============================================================================

test("recordGeneratedDocument uploads before it inserts, and deletes on insert failure", () => {
  assertInOrder(
    recordBody,
    "recordGeneratedDocument",
    [
      "await uploadFile(row.storageKey, input.bytes, mime);",
      "try {",
      "const [inserted] = await insertGeneratedDocumentQuery(row);",
      "await deleteFile(row.storageKey);",
      "throw error;",
    ],
    "upload first; a failed insert must delete the object and must not leave the row"
  );
});

test("recordGeneratedDocument never inserts a key that was not uploaded", () => {
  const uploadAt = recordBody.indexOf("await uploadFile(");
  const insertAt = recordBody.indexOf("insertGeneratedDocumentQuery(");
  assert.ok(uploadAt >= 0 && insertAt > uploadAt);

  const beforeUpload = recordBody.slice(0, uploadAt);
  assert.equal(
    /insertGeneratedDocumentQuery|db\.insert\(/.test(beforeUpload),
    false,
    "an insert before upload would record a key whose object does not exist"
  );
  assert.doesNotMatch(recordBody, /db\.transaction\(/);
});

test("the generation route records after render, and a preview does not record", () => {
  const route = sourceReader(routeSource, "route.ts");
  const handler = route.after("export async function GET");

  assertInOrder(
    handler,
    "GET /api/documents/[templateId]",
    [
      "file = await renderDocument(format, templateId, values);",
      'request.nextUrl.searchParams.get("preview") === "1"',
      "await recordGeneratedDocument(",
    ],
    "bytes are rendered first; persist is gated off preview so a look does not write history"
  );

  assert.match(
    routeSource,
    /churchId:\s*user\.churchId/,
    "the route must persist against the session church, not a client-supplied one"
  );
  assert.match(routeSource, /userId:\s*user\.id/);
  assert.match(routeSource, /bytes:\s*file/);
});

// ============================================================================
// History page — church-scoped list, no storage key on the wire
// ============================================================================

test("the history page lists the session church's documents, newest first", () => {
  assert.match(pageSource, /listGeneratedDocuments\(user\.churchId\)/);
  assert.doesNotMatch(pageSource, /storageKey/);
  assert.match(pageSource, /document\.filename/);
  assert.match(pageSource, /artifactId=\{document\.id\}/);
  assert.match(pageSource, /HeaderBreadcrumbs/);
  assert.match(pageSource, /formatDateWithoutWeekday/);
  assert.match(pageSource, /className="cursor-pointer"/);
});

test("the documents library links to history with cursor-pointer", () => {
  const libraryPage = readFileSync(
    path.join(SRC, "app", "(dashboard)", "documents", "page.tsx"),
    "utf8"
  );
  assert.match(libraryPage, /href="\/documents\/history"/);
  assert.match(libraryPage, /cursor-pointer/);
});
