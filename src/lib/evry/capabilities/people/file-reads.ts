import { z } from "zod";

import { personSources, personStatuses } from "@/db/schema";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { readExactEvryPeopleAttachment } from "@/lib/evry/capabilities/people/attachments";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import { getCommitment } from "@/lib/people/commitments";
import { buildExportFilename } from "@/lib/people/export";
import { parseCsvImport } from "@/lib/people/import";
import { getPeopleForExport } from "@/lib/people/service";

export const PEOPLE_FILE_READ_IDENTITIES = {
  commitmentDownload: "people.crm.assessments.get-commitment-download-url",
  template: "people.crm.imports.download-csv-template",
  preview: "people.crm.imports.preview-import",
  export: "people.crm.exports.export-people",
} as const;

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
const uuid = z.string().uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const exportInput = z.strictObject({
  status: z.array(z.enum(personStatuses)).max(7),
  source: z.array(z.enum(personSources)).max(7),
  search: z.string().max(255).nullable(),
  tagIds: z.array(uuid).max(25),
});
export type PeopleFileReadSelection =
  | Readonly<{ kind: "commitment_download"; commitmentId: string }>
  | Readonly<{ kind: "template" }>
  | Readonly<{
      kind: "export";
      status: string[];
      source: string[];
      search: string | null;
      tagIds: string[];
    }>;

export function selectPeopleFileRead(
  textValue: string
): PeopleFileReadSelection | null {
  const text = textValue.normalize("NFKC").trim();
  if (/^download (?:the )?people csv template[.!?]*$/i.test(text))
    return { kind: "template" };
  const commitment = new RegExp(
    `^download commitment\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text)?.[1];
  if (commitment && uuid.safeParse(commitment).success)
    return { kind: "commitment_download", commitmentId: commitment };
  const match = /^export people(?:\s*:\s*([\s\S]+))?[.!?]*$/i.exec(text);
  if (!match) return null;
  const values: Record<string, string> = {};
  if (match[1]) {
    for (const part of match[1].split(";")) {
      const index = part.indexOf("=");
      if (index <= 0) return null;
      const key = part.slice(0, index).trim();
      if (
        !new Set(["status", "source", "search", "tags"]).has(key) ||
        key in values
      )
        return null;
      values[key] = part.slice(index + 1).trim();
    }
  }
  const parsed = exportInput.safeParse({
    status: values.status ? values.status.split(",").filter(Boolean) : [],
    source: values.source ? values.source.split(",").filter(Boolean) : [],
    search: values.search || null,
    tagIds: values.tags ? values.tags.split(",").filter(Boolean) : [],
  });
  return parsed.success ? { kind: "export", ...parsed.data } : null;
}

const COMMITMENT_DOWNLOAD_READ = defineEvryReadRegistration({
  id: "people.commitment-download",
  capabilityIdentity: PEOPLE_FILE_READ_IDENTITIES.commitmentDownload,
  inputShape: { commitmentId: uuid },
  async run({ authorization }, input) {
    const row = await getCommitment(
      authorization.actor.plantId,
      input.commitmentId
    );
    const available = Boolean(row?.documentUrl);
    return buildEvryReadArtifact({
      title: available
        ? "Commitment document"
        : "Commitment document not found",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: available
        ? []
        : [{ reason: "No document in this plant", count: 1 }],
      items: available
        ? [
            {
              id: row!.id,
              label: `${row!.commitmentType} commitment`,
              facts: [{ label: "Signed", value: row!.signedDate }],
              sourceLink: trustedEvryApplicationSourceLink({
                label: "Download commitment",
                href: `/api/evry/people/files/commitments/${row!.id}`,
              }),
            },
          ]
        : [],
      sourceLinks: [],
    });
  },
});
const TEMPLATE_READ = defineEvryReadRegistration({
  id: "people.csv-template",
  capabilityIdentity: PEOPLE_FILE_READ_IDENTITIES.template,
  inputShape: {},
  async run() {
    return buildEvryReadArtifact({
      title: "People CSV template",
      filters: [],
      exclusions: [],
      items: [
        {
          id: "people-csv-template",
          label: "People CSV template",
          facts: [{ label: "Format", value: "CSV" }],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Download template",
            href: "/api/evry/people/files/template",
          }),
        },
      ],
      sourceLinks: [],
    });
  },
});
export const IMPORT_PREVIEW_READ = defineEvryReadRegistration({
  id: "people.import-preview",
  capabilityIdentity: PEOPLE_FILE_READ_IDENTITIES.preview,
  inputShape: {
    attachmentReference: z.string().min(1).max(4_000),
    attachmentDigest: digest,
  },
  async run({ authorization }, input) {
    const attachment = await readExactEvryPeopleAttachment({
      reference: input.attachmentReference,
      actor: authorization.actor,
      expectedKind: "people_csv",
      expectedDigest: input.attachmentDigest,
    });
    const preview = attachment
      ? await parseCsvImport(
          attachment.bytes.toString("utf8"),
          authorization.actor.plantId
        )
      : null;
    const rows = preview
      ? [
          ...preview.validRows,
          ...preview.duplicateRows,
          ...preview.invalidRows,
        ].toSorted((a, b) => a.rowNumber - b.rowNumber)
      : [];
    return buildEvryReadArtifact({
      title: preview
        ? `Preview ${attachment!.document.originalName}`
        : "Import preview unavailable",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: preview
        ? preview.invalidRows.map((row) => ({
            reason: `Row ${row.rowNumber}: ${row.errors.join("; ")}`,
            count: 1,
          }))
        : [{ reason: "Attachment unavailable", count: 1 }],
      items: rows.map((row) => ({
        id: `csv-row-${row.rowNumber}`,
        label:
          `Row ${row.rowNumber}: ${row.data.firstName ?? ""} ${row.data.lastName ?? ""}`.trim(),
        facts: [
          {
            label: "Status",
            value: row.valid
              ? row.duplicates.exactMatch ||
                row.duplicates.potentialMatches.length
                ? "Duplicate review"
                : "Valid"
              : "Invalid",
          },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open People import",
          href: "/people/import",
        }),
      })),
      sourceLinks: [],
    });
  },
});
const EXPORT_READ = defineEvryReadRegistration({
  id: "people.export",
  capabilityIdentity: PEOPLE_FILE_READ_IDENTITIES.export,
  inputShape: exportInput.shape,
  async run({ authorization }, input) {
    const rows = await getPeopleForExport(authorization.actor.plantId, {
      status: input.status.length ? input.status : undefined,
      source: input.source.length ? input.source : undefined,
      search: input.search ?? undefined,
      tagIds: input.tagIds.length ? input.tagIds : undefined,
    });
    const query = new URLSearchParams();
    for (const status of input.status) query.append("status", status);
    for (const source of input.source) query.append("source", source);
    for (const tag of input.tagIds) query.append("tag", tag);
    if (input.search) query.set("search", input.search);
    const suffix = query.size ? `?${query.toString()}` : "";
    return buildEvryReadArtifact({
      title: "People CSV export",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: [
        {
          id: "people-export",
          label: buildExportFilename(),
          facts: [
            { label: "People", value: String(rows.length) },
            { label: "Format", value: "CSV" },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Download export",
            href: `/api/evry/people/files/export${suffix}`,
          }),
        },
      ],
      sourceLinks: [],
    });
  },
});

export const PEOPLE_FILE_READ_REGISTRATIONS = [
  COMMITMENT_DOWNLOAD_READ,
  TEMPLATE_READ,
  IMPORT_PREVIEW_READ,
  EXPORT_READ,
] as const;
export const continuePeopleFileRead = createEvryReadContinuation({
  registrations: PEOPLE_FILE_READ_REGISTRATIONS,
  async select({ literalUserText, eligibleReadIds }) {
    const selection = selectPeopleFileRead(literalUserText);
    if (!selection) return null;
    const selected =
      selection.kind === "commitment_download"
        ? {
            registration: COMMITMENT_DOWNLOAD_READ,
            input: { commitmentId: selection.commitmentId },
          }
        : selection.kind === "template"
          ? { registration: TEMPLATE_READ, input: {} }
          : {
              registration: EXPORT_READ,
              input: {
                status: selection.status,
                source: selection.source,
                search: selection.search,
                tagIds: selection.tagIds,
              },
            };
    return eligibleReadIds.includes(selected.registration.id)
      ? { readId: selected.registration.id, input: selected.input }
      : null;
  },
});
