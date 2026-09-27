/** Actual route, database and owned S3 proof. Only session lookup is adapted. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { db } from "@/db";
import { churches, generatedDocuments, users, type User } from "@/db/schema";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/templates";
import { previewDocumentBytes } from "@/lib/documents/preview";
import type { DocumentFormat } from "@/lib/documents/types";

async function main() {
  const [directory, evidence] = process.argv.slice(2);
  assert.ok(
    directory?.startsWith("/private/tmp/") &&
      evidence?.startsWith("/private/tmp/")
  );
  const state = JSON.parse(
    readFileSync(join(directory, "ownership.json"), "utf8")
  );
  const fixture = JSON.parse(
    readFileSync(join(directory, "fixtures.json"), "utf8")
  );
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  assert.equal(connection.pathname, `/${fixture.database}`);
  assert.equal(
    (await db.execute<{ name: string }>(sql`select current_database() as name`))
      .rows[0].name,
    fixture.database
  );
  assert.equal(process.env.AWS_ENDPOINT_URL_S3, state.env.AWS_ENDPOINT_URL_S3);
  assert.equal(new URL(process.env.AWS_ENDPOINT_URL_S3!).hostname, "127.0.0.1");
  assert.equal(process.env.AWS_BUCKET_NAME, state.documentStorage.bucket);
  assert.equal(
    process.env.AWS_ACCESS_KEY_ID,
    state.documentStorage.accessKeyId
  );
  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
  });
  const objects = async () =>
    (
      await s3.send(
        new ListObjectsV2Command({ Bucket: process.env.AWS_BUCKET_NAME })
      )
    ).Contents?.map((row) => ({ key: row.Key, etag: row.ETag })).sort((a, b) =>
      a.key!.localeCompare(b.key!)
    ) ?? [];
  const rows = () => db.select().from(generatedDocuments);
  const accounts = await db.select().from(users);
  const owner = accounts.find(
    (user) => user.email === "owner@preview.example.test"
  )!;
  const foreign = accounts.find(
    (user) => user.email === "foreign-owner@preview.example.test"
  )!;
  const coach = accounts.find(
    (user) => user.email === "coach@preview.example.test"
  )!;
  assert.ok(owner && foreign && coach);
  let actor: User | null = owner;
  mock.module("@/lib/auth/session", {
    namedExports: {
      getCurrentSession: async () => ({ user: actor }),
      getCurrentUserChurch: async () =>
        actor?.churchId
          ? ((
              await db
                .select()
                .from(churches)
                .where(eq(churches.id, actor.churchId))
            )[0] ?? null)
          : null,
    },
  });
  const { GET } = await import("@/app/api/documents/[templateId]/route");
  const request = (
    templateId: string,
    format: DocumentFormat,
    preview: boolean,
    values: Record<string, string> = {}
  ) => {
    const query = new URLSearchParams({ format, ...values });
    if (preview) query.set("preview", "1");
    return GET(
      new NextRequest(
        `http://owned-preview.local/api/documents/${templateId}?${query}`
      ),
      { params: Promise.resolve({ templateId }) }
    );
  };
  mkdirSync(evidence, { recursive: true });
  const baselineRows = await rows(),
    baselineObjects = await objects();
  let pairs = 0;
  for (const template of DOCUMENT_TEMPLATES)
    for (const format of template.formats) {
      const values = Object.fromEntries(
        template.mergeFields.map((field) => [field.key, `Preview ${field.key}`])
      );
      const response = await request(template.id, format, true, values);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      if (format === "pdf") {
        assert.match(response.headers.get("content-type")!, /application\/pdf/);
        const bytes = Buffer.from(await response.arrayBuffer());
        const text = execFileSync("pdftotext", ["-", "-"], {
          input: bytes,
          encoding: "utf8",
        }).replace(/\s+/g, " ");
        for (const value of Object.values(values))
          assert.ok(text.includes(value));
        writeFileSync(join(evidence, `${template.id}-preview.pdf`), bytes);
      } else {
        const payload = await response.json();
        assert.equal(payload.format, format);
        for (const value of Object.values(values))
          assert.ok(JSON.stringify(payload).includes(value));
        writeFileSync(
          join(evidence, `${template.id}-preview.json`),
          JSON.stringify(payload)
        );
      }
      pairs++;
    }
  assert.deepEqual(await rows(), baselineRows);
  assert.deepEqual(await objects(), baselineObjects);
  actor = null;
  assert.equal((await request("response-card", "pdf", true)).status, 401);
  actor = coach;
  assert.equal((await request("response-card", "pdf", true)).status, 400);
  actor = owner;
  assert.equal((await request("unknown", "pdf", true)).status, 404);
  const failure = await request("member-expectations", "docx", true, {
    church_name: "X".repeat(2_000_100),
  });
  assert.equal(failure.status, 500);
  assert.equal(
    (
      await request("member-expectations", "docx", true, {
        church_name: "Recovered preview",
      })
    ).status,
    200
  );
  assert.deepEqual(await rows(), baselineRows);
  assert.deepEqual(await objects(), baselineObjects);
  actor = foreign;
  const foreignPreview = await request("member-expectations", "docx", true, {
    churchId: owner.churchId!,
  });
  assert.equal(foreignPreview.status, 200);
  assert.ok(
    JSON.stringify(await foreignPreview.json()).includes(
      "Preview foreign plant"
    )
  );
  actor = owner;
  let generated = 0;
  for (const template of DOCUMENT_TEMPLATES)
    for (const format of template.formats) {
      const values = Object.fromEntries(
        template.mergeFields.map((field) => [
          field.key,
          `Generated ${field.key}`,
        ])
      );
      const response = await request(template.id, format, false, values);
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-disposition")!,
        new RegExp(`attachment; filename="${template.id}\\.${format}"`)
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      const stored = (await rows()).filter(
        (row) =>
          row.templateId === template.id &&
          row.format === format &&
          row.churchId === owner.churchId
      );
      assert.equal(stored.length, 1);
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: stored[0].storageKey,
        })
      );
      assert.ok(
        bytes.equals(Buffer.from(await object.Body!.transformToByteArray()))
      );
      if (format !== "pdf")
        for (const value of Object.values(values))
          assert.ok(
            JSON.stringify(await previewDocumentBytes(format, bytes)).includes(
              value
            )
          );
      generated++;
    }
  assert.equal((await rows()).length, baselineRows.length + generated);
  assert.equal((await objects()).length, baselineObjects.length + generated);
  writeFileSync(
    join(evidence, "assertions.json"),
    JSON.stringify(
      {
        previewPairs: pairs,
        previewHistoryWrites: 0,
        previewStorageWrites: 0,
        authenticationAndTenancy: true,
        controlledFailureRetry: true,
        generatedPairs: generated,
        storedBytesMatchDownloads: true,
      },
      null,
      2
    )
  );
  console.log(
    `PASS: ${pairs} real preview pairs without history/storage writes; auth/tenant and rendering failure/retry; ${generated} actual chosen-format generations persisted identical bytes to owned S3 and history.`
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
