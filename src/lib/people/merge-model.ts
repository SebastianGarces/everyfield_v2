import { z } from "zod";
import type { PersonForClient } from "./types";

export const mergeFields = [
  { key: "name", label: "Name", columns: ["firstName", "lastName"] },
  { key: "email", label: "Email", columns: ["email"] },
  { key: "phone", label: "Phone", columns: ["phone"] },
  {
    key: "address",
    label: "Address",
    columns: [
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
      "country",
    ],
  },
  { key: "status", label: "Pipeline status", columns: ["status"] },
  {
    key: "backgroundCheckStatus",
    label: "Background check",
    columns: ["backgroundCheckStatus"],
  },
  { key: "source", label: "Source", columns: ["source", "sourceDetails"] },
  { key: "notes", label: "Notes", columns: ["notes"] },
  { key: "photo", label: "Photo", columns: [] },
  {
    key: "household",
    label: "Household and role",
    columns: ["householdId", "householdRole"],
  },
] as const;
export type MergeField = (typeof mergeFields)[number]["key"];
export type MergeSide = "left" | "right";
export type MergeChoices = Partial<Record<MergeField, MergeSide>>;
const side = z.enum(["left", "right"]);
export const mergeRequestSchema = z
  .object({
    leftId: z.uuid(),
    rightId: z.uuid(),
    survivor: side,
    leftVersion: z.string().regex(/^[a-f0-9]{32}$/),
    rightVersion: z.string().regex(/^[a-f0-9]{32}$/),
    choices: z
      .object({
        name: side.optional(),
        email: side.optional(),
        phone: side.optional(),
        address: side.optional(),
        status: side.optional(),
        backgroundCheckStatus: side.optional(),
        source: side.optional(),
        notes: side.optional(),
        photo: side.optional(),
        household: side.optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) => value.leftId !== value.rightId,
    "Choose two different people"
  );
export type MergeRequest = z.infer<typeof mergeRequestSchema>;

export type MergeProfile = {
  person: PersonForClient;
  version: string;
  linkedAccount: boolean;
  householdName: string | null;
};
export type MergeReview = {
  left: MergeProfile;
  right: MergeProfile;
  conflicts: MergeField[];
  blockers: string[];
  sharedTags: number;
  survivorBlockers: Record<MergeSide, string[]>;
};

export function mergeFieldText(profile: MergeProfile, key: MergeField): string {
  if (key === "photo")
    return profile.person.photoSrc ? "Photo on this profile" : "No photo";
  if (key === "household")
    return (
      [profile.householdName, profile.person.householdRole]
        .filter(Boolean)
        .join(" · ") || "No household"
    );
  const field = mergeFields.find((field) => field.key === key)!;
  return (
    field.columns
      .map((column) => profile.person[column])
      .filter((value) => value !== null && value !== "")
      .join(" · ") || "Not recorded"
  );
}
