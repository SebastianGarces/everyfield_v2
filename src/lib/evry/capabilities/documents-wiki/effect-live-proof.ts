import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  generatedDocuments,
  sendingChurches,
  users,
  wikiArticles,
  wikiArticleFeedback,
  wikiBookmarks,
} from "@/db/schema";
import { getGeneratedDocument } from "@/lib/documents/service";
import { trustedEvryPlanReview } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_READ_REGISTRATIONS,
} from "@/lib/evry/capabilities/production";
import {
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import {
  parseEvryConversationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { executionEffectKey } from "@/lib/evry/audit/identity";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { createEvryExecutor } from "@/lib/evry/executor/core";
import {
  findEvryExecutionSnapshot,
  finishEvryExecution,
  recordEvryStepOutcome,
  revalidateEvryExecutionStep,
  startOrResumeEvryExecution,
} from "@/lib/evry/executor/repository";
import {
  mintEvryPlanRequestKey,
  parseStoredEvryActionPlan,
} from "@/lib/evry/plans";
import { confirmEvryActionPlan } from "@/lib/evry/plans/service";
import {
  confirmExactEvryActionPlan,
  findExactEvryActionPlan,
} from "@/lib/evry/plans/repository";
import { executeAuthorizedEvryRead } from "@/lib/evry/reads/contract";

import generated from "./inventory.generated.json";
import { withEvryDocumentLiveProofStorage } from "./document-storage";
import {
  DOCUMENTS_WIKI_EFFECT_IDENTITIES,
  DOCUMENTS_WIKI_PLAN_REGISTRY,
  DOCUMENTS_WIKI_REVIEW_REGISTRY,
  proposeDocumentsWikiEffect,
  type DocumentsWikiEffectSelection,
} from "./effects";

async function freshAuthorization(
  identity: string
): Promise<EvryEffectCapabilityAuthorization | null> {
  const registration = evryCapabilityRegistrationFor(identity);
  if (!registration || registration.operationKind !== "effect") return null;
  const [user] = await db
    .select({ id: users.id, churchId: users.churchId, seat: users.seat })
    .from(users)
    .where(
      and(
        eq(users.id, ACTIVE_USER_ID),
        eq(users.churchId, ACTIVE_CHURCH_ID),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId),
        isNotNull(users.seat)
      )
    )
    .limit(1);
  if (!user?.churchId || !user.seat) return null;
  return {
    actor: {
      userId: user.id,
      plantId: user.churchId,
      seat: user.seat,
    } as EvryPlantActor,
    registration,
  } as EvryEffectCapabilityAuthorization;
}

const execute = createEvryExecutor({
  authorizeCapability: freshAuthorization,
  findExactPlan: findExactEvryActionPlan,
  findSnapshot: findEvryExecutionSnapshot,
  startOrResume: startOrResumeEvryExecution,
  revalidateStep: revalidateEvryExecutionStep,
  recordStep: recordEvryStepOutcome,
  finish: finishEvryExecution,
  expirePlan: confirmExactEvryActionPlan,
  now: () => new Date(),
});

let ACTIVE_CHURCH_ID = "";
let ACTIVE_USER_ID = "";
const allowedOutcomes = new Set<string>();
const replayOutcomes = new Set<string>();
const denialOutcomes = new Set<string>();
const foreignRefusalOutcomes = new Set<string>();
const durableOutcomes = new Set<string>();
const errorOutcomes = new Set<string>();
const uiArtifactOutcomes = new Set<string>();

async function freshReadAuthorization(
  identity: string
): Promise<EvryReadCapabilityAuthorization | null> {
  const registration = evryCapabilityRegistrationFor(identity);
  if (!registration || registration.operationKind !== "read") return null;
  const [user] = await db
    .select({ id: users.id, churchId: users.churchId, seat: users.seat })
    .from(users)
    .where(
      and(
        eq(users.id, ACTIVE_USER_ID),
        eq(users.churchId, ACTIVE_CHURCH_ID),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId),
        isNotNull(users.seat)
      )
    )
    .limit(1);
  if (!user?.churchId || !user.seat) return null;
  return {
    actor: {
      userId: user.id,
      plantId: user.churchId,
      seat: user.seat,
    } as EvryPlantActor,
    registration,
  } as EvryReadCapabilityAuthorization;
}

async function prepareEffect(
  actor: EvryPlantActor,
  selection: DocumentsWikiEffectSelection
) {
  const proposal = await proposeDocumentsWikiEffect({
    actor,
    selection,
    requestKey: mintEvryPlanRequestKey(),
  });
  assert.ok(proposal);
  const confirmed = await confirmEvryActionPlan({
    actor,
    planId: proposal.plan.planId,
    fingerprint: proposal.plan.fingerprint,
    decidedAt: new Date(),
    registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
  });
  assert.ok(
    confirmed.status === "approved" || confirmed.status === "already_approved"
  );
  const exact = await findExactEvryActionPlan({
    planId: proposal.plan.planId,
    actorUserId: actor.userId,
    plantId: actor.plantId,
    fingerprint: proposal.plan.fingerprint,
  });
  assert.ok(exact);
  const document = parseStoredEvryActionPlan({
    document: exact.document,
    registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
  });
  assert.equal(document.steps.length, 1);
  parseEvryConversationArtifactDocument(proposal.confirmation);
  uiArtifactOutcomes.add(document.steps[0]!.capabilityIdentity);
  assert.ok(
    await trustedEvryPlanReview({
      actor,
      plan: proposal.plan,
      registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
      reviewRegistry: DOCUMENTS_WIKI_REVIEW_REGISTRY,
    })
  );
  return { proposal, document };
}

async function runEffect(
  actor: EvryPlantActor,
  selection: DocumentsWikiEffectSelection
) {
  const prepared = await prepareEffect(actor, selection);
  const input = {
    actor,
    planId: prepared.proposal.plan.planId,
    fingerprint: prepared.proposal.plan.fingerprint,
    registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
  } as const;
  const simultaneous = await Promise.all([execute(input), execute(input)]);
  for (const result of simultaneous) assert.equal(result.status, "completed");
  const first = simultaneous[0]!;
  const replay = await execute(input);
  assert.equal(first.status, "completed");
  assert.deepEqual(replay, first);
  const snapshot = await findEvryExecutionSnapshot({
    planId: prepared.proposal.plan.planId,
    actorUserId: actor.userId,
    plantId: actor.plantId,
    fingerprint: prepared.proposal.plan.fingerprint,
  });
  assert.equal(snapshot?.terminalStatus, "completed");
  assert.equal(snapshot?.steps.length, 1);
  const identity = prepared.document.steps[0]!.capabilityIdentity;
  allowedOutcomes.add(identity);
  replayOutcomes.add(identity);
  durableOutcomes.add(identity);
  return prepared;
}

function proven(
  set: ReadonlySet<string>,
  identity: string,
  label: string
): true {
  assert.ok(set.has(identity), `${identity} is missing ${label} proof`);
  return true;
}

async function main() {
  const [plant, foreignPlant] = await db
    .insert(churches)
    .values([
      { name: "__Documents wiki proof__" },
      { name: "__Foreign documents wiki proof__" },
    ])
    .returning({ id: churches.id });
  assert.ok(plant && foreignPlant);
  ACTIVE_CHURCH_ID = plant.id;
  const [user, foreignUser] = await db
    .insert(users)
    .values([
      {
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "Ada",
        churchId: plant.id,
        seat: "owner",
      },
      {
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "Grace",
        churchId: foreignPlant.id,
        seat: "owner",
      },
    ])
    .returning({ id: users.id });
  assert.ok(user && foreignUser);
  ACTIVE_USER_ID = user.id;
  const actor = {
    userId: user.id,
    plantId: plant.id,
    seat: "owner",
  } as EvryPlantActor;
  const foreignArticle = await db
    .insert(wikiArticles)
    .values({
      churchId: foreignPlant.id,
      slug: `foreign/${randomUUID()}`,
      title: "Foreign article",
      content: "foreign secret",
      contentType: "guide",
      status: "published",
    })
    .returning({ id: wikiArticles.id, slug: wikiArticles.slug })
    .then(([row]) => row);
  const articleContent = "Literal wiki body 🧭".repeat(100);
  const article = await db
    .insert(wikiArticles)
    .values({
      churchId: plant.id,
      slug: `proof/${randomUUID()}`,
      title: "Healthy launch",
      excerpt: "healthy launch",
      content: articleContent,
      contentType: "guide",
      status: "published",
    })
    .returning({ id: wikiArticles.id, slug: wikiArticles.slug })
    .then(([row]) => row);
  assert.ok(article && foreignArticle);
  const foreignDocumentId = randomUUID();
  await db.insert(generatedDocuments).values({
    id: foreignDocumentId,
    churchId: foreignPlant.id,
    userId: foreignUser.id,
    templateId: "commitment-card",
    format: "pdf",
    storageKey: `documents/${foreignPlant.id}/${foreignDocumentId}.pdf`,
  });

  const stored = new Map<string, Buffer>();
  const documentProof = await withEvryDocumentLiveProofStorage(
    {
      store: async (key, bytes) => {
        stored.set(key, Buffer.from(bytes));
        return key;
      },
    },
    () =>
      runEffect(actor, {
        kind: "generate",
        templateId: "commitment-card",
        format: "pdf",
        provided: { church_name: "Dayspring" },
      })
  );
  assert.equal(stored.size, 1);
  const documentId = String(
    documentProof.document.steps[0]!.arguments.documentId
  );
  const literalDocument = await proposeDocumentsWikiEffect({
    actor,
    selection: {
      kind: "generate",
      templateId: "commitment-card",
      format: "pdf",
      provided: { pastor_name: " null " },
    },
    requestKey: mintEvryPlanRequestKey(),
  });
  assert.ok(literalDocument);
  assert.equal(
    literalDocument.confirmation.steps[0]?.contentPreviews.find(
      ({ label }) => label === "pastor_name"
    )?.content,
    " null "
  );

  const driftDocument = await prepareEffect(actor, {
    kind: "generate",
    templateId: "commitment-card",
    format: "pdf",
    provided: {},
  });
  const driftDocumentId = String(
    driftDocument.document.steps[0]!.arguments.documentId
  );
  await db
    .update(churches)
    .set({ name: "__Changed after confirmation__" })
    .where(eq(churches.id, plant.id));
  const driftDocumentResult = await withEvryDocumentLiveProofStorage(
    {
      store: async (key, bytes) => {
        stored.set(key, Buffer.from(bytes));
        return key;
      },
    },
    () =>
      execute({
        actor,
        planId: driftDocument.proposal.plan.planId,
        fingerprint: driftDocument.proposal.plan.fingerprint,
        registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
      })
  );
  assert.equal(driftDocumentResult.status, "refused");
  assert.equal(await getGeneratedDocument(plant.id, driftDocumentId), null);
  errorOutcomes.add("documents.generate");
  await db
    .update(churches)
    .set({ name: "__Documents wiki proof__" })
    .where(eq(churches.id, plant.id));

  const responseLossDocument = await prepareEffect(actor, {
    kind: "generate",
    templateId: "commitment-card",
    format: "pdf",
    provided: { pastor_name: "Response Loss" },
  });
  const responseLossDocumentSnapshot = await startOrResumeEvryExecution({
    planId: responseLossDocument.proposal.plan.planId,
    actorUserId: actor.userId,
    plantId: actor.plantId,
    fingerprint: responseLossDocument.proposal.plan.fingerprint,
    startedAt: new Date(),
  });
  assert.ok(responseLossDocumentSnapshot);
  const responseLossDocumentStep = responseLossDocument.document.steps[0]!;
  const responseLossDocumentRegistration =
    PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
      responseLossDocumentStep.capabilityIdentity
    );
  const responseLossDocumentAuthorization = await freshAuthorization(
    responseLossDocumentStep.capabilityIdentity
  );
  assert.ok(
    responseLossDocumentRegistration && responseLossDocumentAuthorization
  );
  const responseLossStorage = new Map<string, Buffer>();
  let responseLossStoreCalls = 0;
  await withEvryDocumentLiveProofStorage(
    {
      store: async (key, bytes) => {
        responseLossStoreCalls += 1;
        responseLossStorage.set(key, Buffer.from(bytes));
        return key;
      },
    },
    async () => {
      const direct = await responseLossDocumentRegistration.executeIfCurrent({
        authorization: responseLossDocumentAuthorization,
        effectKey: executionEffectKey(
          responseLossDocument.proposal.plan.planId,
          responseLossDocument.proposal.plan.fingerprint,
          responseLossDocumentStep.id
        ),
        execution: {
          attemptId: responseLossDocumentSnapshot.attempt.id,
          planId: responseLossDocumentSnapshot.attempt.planId,
          actorUserId: actor.userId,
          plantId: actor.plantId,
          fingerprint: responseLossDocumentSnapshot.attempt.fingerprint,
          correlationId: responseLossDocumentSnapshot.attempt.correlationId,
          stepId: responseLossDocumentStep.id,
          capabilityIdentity: responseLossDocumentStep.capabilityIdentity,
        },
        arguments: responseLossDocumentStep.arguments,
      });
      assert.equal(direct.status, "completed");
      const recovered = await execute({
        actor,
        planId: responseLossDocument.proposal.plan.planId,
        fingerprint: responseLossDocument.proposal.plan.fingerprint,
        registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
      });
      assert.equal(recovered.status, "completed");
    }
  );
  assert.equal(
    responseLossStorage.size,
    1,
    "durable document marker prevented a second storage effect"
  );
  assert.equal(
    responseLossStoreCalls,
    1,
    "response-loss replay did not repeat the storage effect"
  );
  const pagedDocuments = Array.from({ length: 26 }, (_, index) => {
    const id = randomUUID();
    return {
      id,
      churchId: plant.id,
      userId: user.id,
      templateId: "commitment-card",
      format: "pdf" as const,
      storageKey: `documents/${plant.id}/${id}.pdf`,
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, 26 - index)),
    };
  });
  await db.insert(generatedDocuments).values(pagedDocuments);
  const exactCursorBoundary = [
    pagedDocuments[22]!,
    pagedDocuments[23]!,
  ] as const;
  await db.execute(sql`
    update generated_documents
    set created_at = case id
      when ${exactCursorBoundary[0].id}::uuid then '2020-01-01 00:00:03.123999'::timestamp
      when ${exactCursorBoundary[1].id}::uuid then '2020-01-01 00:00:03.123456'::timestamp
    end
    where id in (${exactCursorBoundary[0].id}::uuid, ${exactCursorBoundary[1].id}::uuid)
  `);
  await db.insert(wikiArticles).values(
    Array.from({ length: 30 }, (_, index) => ({
      churchId: plant.id,
      slug: `pagination/${String(index).padStart(2, "0")}-${randomUUID()}`,
      title: `Pagination article ${index}`,
      excerpt: index < 12 ? "paginationneedle" : "other",
      content: index < 12 ? "paginationneedle" : "other",
      contentType: "guide" as const,
      status: "published" as const,
      sortOrder: index,
    }))
  );

  const readInputs: Record<string, unknown> = {
    "documents.templates.list": {},
    "documents.history.list": { cursor: null },
    "documents.history.download": { documentId },
    "wiki.search": { query: "healthy launch", page: 1 },
    "wiki.article.read": { slug: article.slug, page: 1 },
    "wiki.navigation.read": { page: 1 },
    "wiki.progress.read": { page: 1 },
  };
  const readResults = new Map<string, unknown>();
  for (const registration of PRODUCTION_EVRY_READ_REGISTRATIONS.filter(
    ({ capabilityIdentity }) => capabilityIdentity in readInputs
  )) {
    const authorization = await freshReadAuthorization(
      registration.capabilityIdentity
    );
    assert.ok(authorization);
    const context = { literalUserText: "live proof", pageContext: null };
    const first = await executeAuthorizedEvryRead(
      registration,
      authorization,
      context,
      readInputs[registration.capabilityIdentity]
    );
    const replay = await executeAuthorizedEvryRead(
      registration,
      authorization,
      context,
      readInputs[registration.capabilityIdentity]
    );
    assert.ok(first?.kind === "read");
    assert.deepEqual(replay, first);
    storedEvryReadArtifactDocument(first);
    assert.equal(
      await executeAuthorizedEvryRead(registration, authorization, context, {
        foreignPlantId: foreignPlant.id,
      }),
      null
    );
    readResults.set(registration.capabilityIdentity, first);
    allowedOutcomes.add(registration.capabilityIdentity);
    replayOutcomes.add(registration.capabilityIdentity);
    durableOutcomes.add(registration.capabilityIdentity);
    errorOutcomes.add(registration.capabilityIdentity);
    uiArtifactOutcomes.add(registration.capabilityIdentity);
  }
  assert.match(
    JSON.stringify(readResults.get("documents.history.download")),
    new RegExp(documentId)
  );
  assert.doesNotMatch(
    JSON.stringify(readResults),
    new RegExp(
      `${foreignDocumentId}|foreign secret|${foreignArticle.slug.replaceAll("/", "\\/")}`,
      "i"
    )
  );

  const registrationFor = (identity: string) => {
    const registration = PRODUCTION_EVRY_READ_REGISTRATIONS.find(
      ({ capabilityIdentity }) => capabilityIdentity === identity
    );
    assert.ok(registration);
    return registration;
  };
  const executeRead = async (identity: string, input: unknown) => {
    const registration = registrationFor(identity);
    const authorization = await freshReadAuthorization(identity);
    assert.ok(authorization);
    const artifact = await executeAuthorizedEvryRead(
      registration,
      authorization,
      { literalUserText: "pagination proof", pageContext: null },
      input
    );
    assert.equal(artifact?.kind, "read");
    assert.ok(artifact?.kind === "read");
    storedEvryReadArtifactDocument(artifact);
    return artifact;
  };
  const historyPageOne = await executeRead("documents.history.list", {
    cursor: null,
  });
  const historyCursor = historyPageOne.items
    .at(-1)
    ?.facts.find(({ label }) => label === "Next cursor")?.value;
  assert.ok(historyCursor);
  const historyPageTwo = await executeRead("documents.history.list", {
    cursor: historyCursor,
  });
  assert.equal(
    new Set(
      [...historyPageOne.items, ...historyPageTwo.items].map(({ id }) => id)
    ).size,
    28
  );
  assert.deepEqual(
    exactCursorBoundary
      .map(({ id }) => id)
      .filter((id) =>
        [...historyPageOne.items, ...historyPageTwo.items].some(
          (item) => item.id === id
        )
      ),
    exactCursorBoundary.map(({ id }) => id),
    "exact timestamp cursors retain adjacent rows inside one millisecond"
  );
  assert.equal(
    [...historyPageOne.items, ...historyPageTwo.items].some(
      ({ id }) => id === foreignDocumentId
    ),
    false
  );

  const searchPageOne = await executeRead("wiki.search", {
    query: "paginationneedle",
    page: 1,
  });
  const searchPageTwo = await executeRead("wiki.search", {
    query: "paginationneedle",
    page: 2,
  });
  assert.equal(searchPageOne.items.length, 10);
  assert.equal(searchPageTwo.items.length, 2);
  assert.equal(
    new Set(
      [...searchPageOne.items, ...searchPageTwo.items].map(({ id }) => id)
    ).size,
    12
  );

  for (const identity of ["wiki.navigation.read", "wiki.progress.read"]) {
    const pageOne = await executeRead(identity, { page: 1 });
    const pageTwo = await executeRead(identity, { page: 2 });
    assert.equal(pageOne.items.length, 25);
    assert.ok(pageTwo.items.length > 0);
    assert.equal(
      new Set([...pageOne.items, ...pageTwo.items].map(({ id }) => id)).size,
      pageOne.items.length + pageTwo.items.length
    );
  }

  const articlePages = await Promise.all(
    Array.from({ length: Math.ceil(articleContent.length / 500) }, (_, index) =>
      executeRead("wiki.article.read", { slug: article.slug, page: index + 1 })
    )
  );
  assert.equal(
    articlePages
      .map(
        (pageResult) =>
          pageResult.items[0]?.facts.find(
            ({ label }) => label === "Literal content"
          )?.value ?? ""
      )
      .join(""),
    articleContent
  );

  const downloadRegistration = PRODUCTION_EVRY_READ_REGISTRATIONS.find(
    ({ capabilityIdentity }) =>
      capabilityIdentity === "documents.history.download"
  );
  const articleRegistration = PRODUCTION_EVRY_READ_REGISTRATIONS.find(
    ({ capabilityIdentity }) => capabilityIdentity === "wiki.article.read"
  );
  assert.ok(downloadRegistration && articleRegistration);
  const downloadAuthorization = await freshReadAuthorization(
    downloadRegistration.capabilityIdentity
  );
  const articleAuthorization = await freshReadAuthorization(
    articleRegistration.capabilityIdentity
  );
  assert.ok(downloadAuthorization && articleAuthorization);
  const foreignDownload = await executeAuthorizedEvryRead(
    downloadRegistration,
    downloadAuthorization,
    { literalUserText: "foreign proof", pageContext: null },
    { documentId: foreignDocumentId }
  );
  const foreignArticleRead = await executeAuthorizedEvryRead(
    articleRegistration,
    articleAuthorization,
    { literalUserText: "foreign proof", pageContext: null },
    { slug: foreignArticle.slug, page: 1 }
  );
  assert.equal(foreignDownload?.kind, "read");
  assert.equal(foreignArticleRead?.kind, "read");
  if (foreignDownload?.kind === "read")
    assert.equal(foreignDownload.items.length, 0);
  if (foreignArticleRead?.kind === "read")
    assert.equal(foreignArticleRead.items.length, 0);
  for (const identity of Object.values({
    templates: "documents.templates.list",
    history: "documents.history.list",
    download: "documents.history.download",
    search: "wiki.search",
    article: "wiki.article.read",
    navigation: "wiki.navigation.read",
    progress: "wiki.progress.read",
  }))
    foreignRefusalOutcomes.add(identity);
  assert.equal(documentProof.document.steps[0]!.arguments.churchId, undefined);
  foreignRefusalOutcomes.add("documents.generate");

  await runEffect(actor, {
    kind: "bookmark",
    slug: article.slug,
    bookmarked: true,
  });
  await runEffect(actor, {
    kind: "progress",
    slug: article.slug,
    status: "completed",
    scrollPosition: 1,
  });
  await runEffect(actor, {
    kind: "feedback",
    slug: article.slug,
    rating: "helpful",
  });

  for (const [identity, selection] of [
    [
      "wiki.bookmark.set",
      { kind: "bookmark", slug: foreignArticle.slug, bookmarked: true },
    ],
    [
      "wiki.progress.set",
      {
        kind: "progress",
        slug: foreignArticle.slug,
        status: "completed",
        scrollPosition: 1,
      },
    ],
    [
      "wiki.feedback.set",
      { kind: "feedback", slug: foreignArticle.slug, rating: "helpful" },
    ],
  ] as const) {
    assert.equal(
      await proposeDocumentsWikiEffect({
        actor,
        selection,
        requestKey: mintEvryPlanRequestKey(),
      }),
      null
    );
    foreignRefusalOutcomes.add(identity);
  }

  const responseLossArticle = await db
    .insert(wikiArticles)
    .values({
      churchId: plant.id,
      slug: `response-loss/${randomUUID()}`,
      title: "Response loss article",
      content: "response loss",
      contentType: "guide",
      status: "published",
    })
    .returning({ slug: wikiArticles.slug })
    .then(([row]) => row);
  assert.ok(responseLossArticle);
  const responseLossPlan = await prepareEffect(actor, {
    kind: "bookmark",
    slug: responseLossArticle.slug,
    bookmarked: true,
  });
  const responseLossSnapshot = await startOrResumeEvryExecution({
    planId: responseLossPlan.proposal.plan.planId,
    actorUserId: actor.userId,
    plantId: actor.plantId,
    fingerprint: responseLossPlan.proposal.plan.fingerprint,
    startedAt: new Date(),
  });
  assert.ok(responseLossSnapshot);
  const responseLossStep = responseLossPlan.document.steps[0]!;
  const responseLossRegistration =
    PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
      responseLossStep.capabilityIdentity
    );
  const responseLossAuthorization = await freshAuthorization(
    responseLossStep.capabilityIdentity
  );
  assert.ok(responseLossRegistration && responseLossAuthorization);
  const directResponseLossResult =
    await responseLossRegistration.executeIfCurrent({
      authorization: responseLossAuthorization,
      effectKey: executionEffectKey(
        responseLossPlan.proposal.plan.planId,
        responseLossPlan.proposal.plan.fingerprint,
        responseLossStep.id
      ),
      execution: {
        attemptId: responseLossSnapshot.attempt.id,
        planId: responseLossSnapshot.attempt.planId,
        actorUserId: actor.userId,
        plantId: actor.plantId,
        fingerprint: responseLossSnapshot.attempt.fingerprint,
        correlationId: responseLossSnapshot.attempt.correlationId,
        stepId: responseLossStep.id,
        capabilityIdentity: responseLossStep.capabilityIdentity,
      },
      arguments: responseLossStep.arguments,
    });
  assert.equal(directResponseLossResult.status, "completed");
  const bookmarkBeforeRecovery = await db
    .select()
    .from(wikiBookmarks)
    .where(
      and(
        eq(wikiBookmarks.userId, user.id),
        eq(wikiBookmarks.articleSlug, responseLossArticle.slug)
      )
    );
  assert.equal(bookmarkBeforeRecovery.length, 1);
  const responseLossRecovery = await execute({
    actor,
    planId: responseLossPlan.proposal.plan.planId,
    fingerprint: responseLossPlan.proposal.plan.fingerprint,
    registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
  });
  assert.equal(responseLossRecovery.status, "completed");
  const bookmarkAfterRecovery = await db
    .select()
    .from(wikiBookmarks)
    .where(
      and(
        eq(wikiBookmarks.userId, user.id),
        eq(wikiBookmarks.articleSlug, responseLossArticle.slug)
      )
    );
  assert.deepEqual(bookmarkAfterRecovery, bookmarkBeforeRecovery);

  const raceArticle = await db
    .insert(wikiArticles)
    .values({
      churchId: plant.id,
      slug: `race/${randomUUID()}`,
      title: "Race article",
      content: "race",
      contentType: "guide",
      status: "published",
    })
    .returning({ slug: wikiArticles.slug })
    .then(([row]) => row);
  assert.ok(raceArticle);
  const racePlans = await Promise.all([
    prepareEffect(actor, {
      kind: "bookmark",
      slug: raceArticle.slug,
      bookmarked: true,
    }),
    prepareEffect(actor, {
      kind: "bookmark",
      slug: raceArticle.slug,
      bookmarked: true,
    }),
  ]);
  const raceResults = await Promise.all(
    racePlans.map(({ proposal }) =>
      execute({
        actor,
        planId: proposal.plan.planId,
        fingerprint: proposal.plan.fingerprint,
        registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
      })
    )
  );
  assert.deepEqual(raceResults.map(({ status }) => status).toSorted(), [
    "completed",
    "refused",
  ]);
  assert.equal(
    (
      await db
        .select()
        .from(wikiBookmarks)
        .where(
          and(
            eq(wikiBookmarks.userId, user.id),
            eq(wikiBookmarks.articleSlug, raceArticle.slug)
          )
        )
    ).length,
    1
  );

  for (const kind of ["bookmark", "progress", "feedback"] as const) {
    const driftArticle = await db
      .insert(wikiArticles)
      .values({
        churchId: plant.id,
        slug: `drift/${kind}/${randomUUID()}`,
        title: "Before drift",
        content: "before",
        contentType: "guide",
        status: "published",
      })
      .returning({ id: wikiArticles.id, slug: wikiArticles.slug })
      .then(([row]) => row);
    assert.ok(driftArticle);
    const selection: DocumentsWikiEffectSelection =
      kind === "bookmark"
        ? { kind, slug: driftArticle.slug, bookmarked: true }
        : kind === "progress"
          ? {
              kind,
              slug: driftArticle.slug,
              status: "completed",
              scrollPosition: 1,
            }
          : { kind, slug: driftArticle.slug, rating: "helpful" };
    const driftPlan = await prepareEffect(actor, selection);
    await db
      .update(wikiArticles)
      .set({
        title: "After drift",
        content: "after",
        updatedAt: new Date(Date.now() + 1_000),
      })
      .where(eq(wikiArticles.id, driftArticle.id));
    const driftResult = await execute({
      actor,
      planId: driftPlan.proposal.plan.planId,
      fingerprint: driftPlan.proposal.plan.fingerprint,
      registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
    });
    assert.equal(driftResult.status, "refused");
    errorOutcomes.add(DOCUMENTS_WIKI_EFFECT_IDENTITIES[kind]);
  }
  assert.equal(
    (
      await db
        .select()
        .from(wikiArticleFeedback)
        .where(
          and(
            eq(wikiArticleFeedback.churchId, plant.id),
            eq(wikiArticleFeedback.userId, user.id)
          )
        )
    ).filter(({ articleSlug }) => articleSlug.startsWith("drift/")).length,
    0
  );

  const [sending] = await db
    .insert(sendingChurches)
    .values({ name: "__Dual tenant proof__" })
    .returning({ id: sendingChurches.id });
  assert.ok(sending);
  const deniedArticle = await db
    .insert(wikiArticles)
    .values({
      churchId: plant.id,
      slug: `denied/${randomUUID()}`,
      title: "Denied article",
      content: "denied",
      contentType: "guide",
      status: "published",
    })
    .returning({ slug: wikiArticles.slug })
    .then(([row]) => row);
  assert.ok(deniedArticle);
  const deniedPlan = await prepareEffect(actor, {
    kind: "bookmark",
    slug: deniedArticle.slug,
    bookmarked: true,
  });
  await db
    .update(users)
    .set({ sendingChurchId: sending.id })
    .where(eq(users.id, user.id));
  for (const capability of generated.capabilities) {
    assert.equal(
      capability.operationKind === "effect"
        ? await freshAuthorization(capability.identity)
        : await freshReadAuthorization(capability.identity),
      null
    );
    denialOutcomes.add(capability.identity);
  }
  const deniedResult = await execute({
    actor,
    planId: deniedPlan.proposal.plan.planId,
    fingerprint: deniedPlan.proposal.plan.fingerprint,
    registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
  });
  assert.equal(deniedResult.status, "refused");
  assert.equal(
    (
      await db
        .select()
        .from(wikiBookmarks)
        .where(
          and(
            eq(wikiBookmarks.userId, user.id),
            eq(wikiBookmarks.articleSlug, deniedArticle.slug)
          )
        )
    ).length,
    0
  );
  await db
    .update(users)
    .set({ sendingChurchId: null })
    .where(eq(users.id, user.id));

  const outcomes = generated.capabilities.map(
    ({ identity, operationKind }) => ({
      identity,
      operationKind,
      allowed: proven(allowedOutcomes, identity, "allowed execution"),
      replayed: proven(replayOutcomes, identity, "replay"),
      denied: proven(denialOutcomes, identity, "fresh denial"),
      foreignRefused: proven(
        foreignRefusalOutcomes,
        identity,
        "foreign refusal"
      ),
      durable: proven(durableOutcomes, identity, "durable result"),
      errors: proven(errorOutcomes, identity, "closed error outcome"),
      uiArtifact: proven(uiArtifactOutcomes, identity, "typed UI artifact"),
    })
  );
  process.stdout.write(
    `DOCUMENTS_WIKI_CAPABILITY_OUTCOMES=${JSON.stringify(outcomes)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`
  );
  process.exitCode = 1;
});
