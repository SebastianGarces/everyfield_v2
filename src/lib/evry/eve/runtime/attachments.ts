import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { evryEveAttachments, evryEveSessions } from "@/db/schema/evry-eve";
import {
  openEvryPeopleAttachmentReference,
  readExactEvryPeopleAttachment,
} from "@/lib/evry/capabilities/people/attachments";
import {
  authorizeEvryEffectCapability,
  authorizeEvryReadCapability,
} from "@/lib/evry/eligibility/capabilities";
import type { EveSessionOwner } from "./session-store";
import type {
  EveAttachmentKind,
  EveResolvedAttachment,
} from "./attachment-contract";
import { eveAttachmentKindSchema } from "./attachment-contract";

type Scope = EveSessionOwner & Readonly<{ sessionId: string }>;
type Binding = typeof evryEveAttachments.$inferSelect;
export interface EveAttachmentStore {
  insert(binding: Binding): Promise<void>;
  find(
    scope: Scope,
    key: { id: string } | { referenceHash: string },
    now: Date
  ): Promise<Binding | null>;
}

/** The insert and every lookup require the same live session ownership as ordinary chat access. */
export const eveAttachmentStore: EveAttachmentStore = {
  async insert(binding) {
    const { db } = await import("@/db");
    await db.execute(sql`insert into evry_eve_attachments
      (id,session_id,church_id,user_id,reference_hash,reference,kind,digest,expires_at)
      select ${binding.id}::uuid,s.id,s.church_id,s.user_id,${binding.referenceHash},${binding.reference},${binding.kind},${binding.digest},${binding.expiresAt.toISOString()}::timestamptz
      from evry_eve_sessions s where s.id=${binding.sessionId} and s.church_id=${binding.churchId}::uuid and s.user_id=${binding.userId}::uuid and s.archived_at is null
      on conflict (session_id,reference_hash) do nothing`);
  },
  async find(scope, key, now) {
    const { db } = await import("@/db");
    const [result] = await db
      .select({ binding: evryEveAttachments })
      .from(evryEveAttachments)
      .innerJoin(
        evryEveSessions,
        eq(evryEveSessions.id, evryEveAttachments.sessionId)
      )
      .where(
        and(
          eq(evryEveAttachments.sessionId, scope.sessionId),
          eq(evryEveAttachments.churchId, scope.plantId),
          eq(evryEveAttachments.userId, scope.userId),
          eq(evryEveSessions.churchId, scope.plantId),
          eq(evryEveSessions.userId, scope.userId),
          isNull(evryEveSessions.archivedAt),
          gt(evryEveAttachments.expiresAt, now),
          "id" in key
            ? eq(evryEveAttachments.id, key.id)
            : eq(evryEveAttachments.referenceHash, key.referenceHash)
        )
      )
      .limit(1);
    return result?.binding ?? null;
  },
};

/** Uses the same capability decisions as the native staging endpoint. */
export async function authorizeEveAttachment(
  owner: EveSessionOwner,
  kind: EveAttachmentKind
) {
  const authorization =
    kind === "people_csv"
      ? await authorizeEvryReadCapability("people.crm.imports.preview-import")
      : await authorizeEvryEffectCapability(
          kind === "person_photo"
            ? "people.crm.people.upload-person-photo"
            : "people.crm.assessments.create-commitment"
        );
  return Boolean(
    authorization &&
    authorization.actor.userId === owner.userId &&
    authorization.actor.plantId === owner.plantId
  );
}

export function createEveAttachmentService(deps: {
  store: EveAttachmentStore;
  authorize: typeof authorizeEveAttachment;
  readExact?: typeof readExactEvryPeopleAttachment;
  open?: typeof openEvryPeopleAttachmentReference;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  function resolveBinding(
    scope: Scope,
    binding: Binding,
    kind: EveAttachmentKind,
    instant: Date
  ): EveResolvedAttachment | null {
    if (
      binding.sessionId !== scope.sessionId ||
      binding.churchId !== scope.plantId ||
      binding.userId !== scope.userId ||
      binding.kind !== kind ||
      binding.expiresAt <= instant
    )
      return null;
    const document = (deps.open ?? openEvryPeopleAttachmentReference)({
      actor: scope,
      reference: binding.reference,
      expectedKind: kind,
      now: instant,
    });
    if (
      !document ||
      document.digest !== binding.digest ||
      document.expiresAt !== binding.expiresAt.toISOString() ||
      createHash("sha256").update(binding.reference).digest("hex") !==
        binding.referenceHash
    )
      return null;
    return {
      reference: binding.reference,
      digest: binding.digest,
      descriptor: {
        attachmentId: binding.id,
        kind,
        name: document.originalName,
        size: document.size,
        personId: document.personId,
      },
    };
  }
  return {
    async bind(
      scope: Scope,
      input: { reference: string; digest: string; kind: EveAttachmentKind }
    ) {
      if (!(await deps.authorize(scope, input.kind))) return null;
      const instant = now();
      const exact = await (deps.readExact ?? readExactEvryPeopleAttachment)({
        actor: scope,
        reference: input.reference,
        expectedKind: input.kind,
        expectedDigest: input.digest,
        now: instant,
      });
      // Browser uploads are finalized chunk manifests, never model-provided inline bytes.
      if (!exact || exact.document.version !== 3) return null;
      const referenceHash = createHash("sha256")
        .update(input.reference)
        .digest("hex");
      await deps.store.insert({
        id: randomUUID(),
        sessionId: scope.sessionId,
        churchId: scope.plantId,
        userId: scope.userId,
        referenceHash,
        reference: input.reference,
        digest: input.digest,
        kind: input.kind,
        expiresAt: new Date(exact.document.expiresAt),
      });
      const binding = await deps.store.find(scope, { referenceHash }, instant);
      return binding
        ? (resolveBinding(scope, binding, input.kind, instant)?.descriptor ??
            null)
        : null;
    },
    async resolve(
      scope: Scope,
      attachmentId: string,
      expectedKind?: EveAttachmentKind
    ) {
      const instant = now();
      const binding = await deps.store.find(
        scope,
        { id: attachmentId },
        instant
      );
      if (!binding) return null;
      const kind = eveAttachmentKindSchema.safeParse(binding.kind);
      if (
        !kind.success ||
        (expectedKind && expectedKind !== kind.data) ||
        !(await deps.authorize(scope, kind.data))
      )
        return null;
      return resolveBinding(scope, binding, kind.data, instant);
    },
  };
}

export const eveAttachments = createEveAttachmentService({
  store: eveAttachmentStore,
  authorize: authorizeEveAttachment,
});
