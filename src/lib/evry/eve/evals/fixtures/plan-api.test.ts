import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "./stack";
import { createFixtureStore } from "./store";
import { createFixtureManifest } from "./manifest";

test(
  "actual Eve preparation and exact plan routes preserve approval, edit, cancellation and retry semantics",
  { skip: process.env.EVRY_EVE_PLAN_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    const deliveries: {
      to: string[];
      subject: string;
      idempotencyKey: string;
    }[] = [];
    let failFirstSend = true;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        );
        if (url.hostname === "api.resend.com") {
          assert.equal(url.pathname, "/emails");
          const body = z
            .object({
              to: z.array(z.string()),
              subject: z.string(),
              html: z.string(),
              text: z.string(),
            })
            .parse(JSON.parse(String(init?.body)));
          const idempotencyKey = new Headers(init?.headers).get(
            "idempotency-key"
          );
          assert.ok(idempotencyKey);
          deliveries.push({
            to: body.to,
            subject: body.subject,
            idempotencyKey,
          });
          if (failFirstSend) {
            failFirstSend = false;
            return Response.json(
              { name: "application_error", message: "Fixture provider outage" },
              { status: 503 }
            );
          }
          return Response.json({ id: randomUUID() });
        }
        if (url.origin !== new URL(stack.proxyUrl).origin)
          throw new Error(
            `Unexpected external request in plan proof: ${url.hostname}`
          );
        return originalFetch(input, init);
      };
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const { requireEvryPlantViewerForSession } =
        await import("@/lib/evry/eligibility/viewer");
      const { authorizeEvryReadCapabilityForSession } =
        await import("@/lib/evry/eligibility/capabilities");
      const { createEvePreparation } = await import("../../preparation");
      const { evryConversationPlanIdentitySchema } =
        await import("@/lib/evry/conversations/contract");
      const { readEvePlanReview } = await import("../../runtime/plan-review");
      const routes = await import("@/app/api/evry/eve/plans/[planId]/route");
      const store = createFixtureStore(stack.container);
      const manifest = createFixtureManifest("orientation-plan-api", 0);
      store.seed(manifest);
      const actor = await requireEvryPlantViewerForSession(manifest.sessionId);
      const preparation = createEvePreparation({
        actor,
        conversationId: randomUUID(),
        userRequestKey: randomUUID(),
        literalUserText:
          "Create an orientation for the core team next Sunday at 10am at church. Two hours; use the saved invitation template.",
        pageContext: null,
        now: new Date(),
        authorizeRead: (identity) =>
          authorizeEvryReadCapabilityForSession(identity, manifest.sessionId),
      });
      const request = {
        operation: "recipe.meeting-invite",
        arguments: {
          meetingType: "orientation",
          title: "Core team orientation",
          dateTime: { date: "2026-09-27", time: "10:00" },
          durationMinutes: 120,
          audience: "core_team",
          locationId: manifest.ids["church-location"],
          subject: "Join our orientation",
          body: "Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.",
        },
      };
      const prepare = async (
        callId: string,
        subject = request.arguments.subject
      ) => {
        const result = await withAuthenticatedSessionId(
          manifest.sessionId,
          () =>
            preparation.prepare(
              {
                request: {
                  ...request,
                  arguments: { ...request.arguments, subject },
                },
              },
              { callId }
            )
        );
        return z
          .object({
            activePlan: z.object({
              mode: z.literal("set"),
              plan: evryConversationPlanIdentitySchema,
            }),
          })
          .parse(result).activePlan.plan;
      };
      const post = async (
        identity: { planId: string; fingerprint: string },
        action: "edit" | "cancel" | "confirm" | "retry"
      ) =>
        withAuthenticatedSessionId(manifest.sessionId, () =>
          routes.POST(
            new Request(
              `http://eve-fixture.test/api/evry/eve/plans/${identity.planId}`,
              {
                method: "POST",
                headers: {
                  origin: "http://eve-fixture.test",
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  fingerprint: identity.fingerprint,
                  action,
                }),
              }
            ),
            { params: Promise.resolve({ planId: identity.planId }) }
          )
        );
      const before = store.auditStart();
      const initial = await prepare("orientation-prepare-1");
      assert.deepEqual(
        await prepare("orientation-prepare-1"),
        initial,
        "same host call replays the exact plan"
      );
      const review = await withAuthenticatedSessionId(manifest.sessionId, () =>
        readEvePlanReview(actor, initial)
      );
      assert.ok(review);
      assert.equal(review.artifact.kind, "confirmation");
      const get = await withAuthenticatedSessionId(manifest.sessionId, () =>
        routes.GET(
          new Request(
            `http://eve-fixture.test/api/evry/eve/plans/${initial.planId}?fingerprint=${initial.fingerprint}`
          ),
          { params: Promise.resolve({ planId: initial.planId }) }
        )
      );
      assert.equal(get.status, 200);
      const invalid = await withAuthenticatedSessionId(manifest.sessionId, () =>
        routes.POST(
          new Request(
            `http://eve-fixture.test/api/evry/eve/plans/${initial.planId}`,
            {
              method: "POST",
              headers: {
                origin: "http://eve-fixture.test",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                fingerprint: "not-a-fingerprint",
                action: "confirm",
              }),
            }
          ),
          { params: Promise.resolve({ planId: initial.planId }) }
        )
      );
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { status: "invalid" });
      const crossOrigin = await withAuthenticatedSessionId(
        manifest.sessionId,
        () =>
          routes.POST(
            new Request(
              `http://eve-fixture.test/api/evry/eve/plans/${initial.planId}`,
              {
                method: "POST",
                headers: {
                  origin: "https://attacker.example",
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  fingerprint: initial.fingerprint,
                  action: "confirm",
                }),
              }
            ),
            { params: Promise.resolve({ planId: initial.planId }) }
          )
      );
      assert.equal(crossOrigin.status, 403);
      assert.deepEqual(await crossOrigin.json(), { status: "unavailable" });
      const foreignSession = randomBytes(32).toString("hex");
      store.sql(
        `insert into sessions(id,user_id,expires_at) values('${foreignSession}','${manifest.ids["foreign-actor"]}',now()+interval '60 days')`
      );
      const foreignReview = await withAuthenticatedSessionId(
        foreignSession,
        () =>
          routes.GET(
            new Request(
              `http://eve-fixture.test/api/evry/eve/plans/${initial.planId}?fingerprint=${initial.fingerprint}`
            ),
            { params: Promise.resolve({ planId: initial.planId }) }
          )
      );
      assert.equal(foreignReview.status, 404);
      assert.deepEqual(await foreignReview.json(), { status: "unavailable" });
      assert.equal(
        store.writesSince(before, manifest).length,
        0,
        "preparation and GET must not write domain data"
      );
      assert.equal(deliveries.length, 0);
      assert.equal(
        (await post(initial, "retry")).status,
        409,
        "retry cannot grant approval"
      );
      assert.equal((await post(initial, "edit")).status, 200);
      assert.equal(
        (await post(initial, "confirm")).status,
        409,
        "editing invalidates the old approval target"
      );
      const replacement = await prepare(
        "orientation-prepare-2",
        "Updated orientation invitation"
      );
      assert.notEqual(replacement.planId, initial.planId);
      assert.notEqual(replacement.fingerprint, initial.fingerprint);
      assert.equal((await post(replacement, "cancel")).status, 200);
      assert.equal(
        (await post(replacement, "confirm")).status,
        409,
        "cancelled reviews cannot run"
      );
      assert.equal(deliveries.length, 0);
      const final = await prepare(
        "orientation-prepare-3",
        "Final orientation invitation"
      );
      const confirmed = await post(final, "confirm");
      assert.equal(
        confirmed.status,
        200,
        JSON.stringify(await confirmed.clone().json())
      );
      const retried = await post(final, "retry");
      assert.equal(
        retried.status,
        200,
        JSON.stringify(await retried.clone().json())
      );
      assert.equal(
        z
          .object({ artifact: z.object({ kind: z.string() }) })
          .parse(await retried.clone().json()).artifact.kind,
        "result"
      );
      const after = store.query(
        `select (select count(*)::int from church_meetings where church_id='${actor.plantId}' and title='Core team orientation') meetings,(select count(*)::int from communications where church_id='${actor.plantId}') messages,(select count(*)::int from communication_recipients where church_id='${actor.plantId}' and status='sent') sent`
      )[0];
      assert.deepEqual(after, { meetings: 1, messages: 1, sent: 2 });
      assert.deepEqual(
        store.query(
          `select type,datetime::text,duration_minutes,location_id from church_meetings where church_id='${actor.plantId}' and title='Core team orientation'`
        ),
        [
          {
            type: "orientation",
            datetime: "2026-09-27 10:00:00",
            duration_minutes: 120,
            location_id: manifest.ids["church-location"],
          },
        ]
      );
      assert.deepEqual(
        store
          .query(
            `select a.person_id from meeting_attendance a join church_meetings m on m.id=a.meeting_id and m.church_id=a.church_id where m.church_id='${actor.plantId}' and m.title='Core team orientation' order by a.person_id`
          )
          .map((row) => row.person_id),
        [manifest.ids["core-alex"], manifest.ids["core-jordan"]].sort()
      );
      assert.equal(
        deliveries.length,
        3,
        "one transient attempt plus two accepted recipient sends"
      );
      assert.deepEqual(
        [...new Set(deliveries.flatMap((delivery) => delivery.to))].sort(),
        [
          `${manifest.ids["core-alex"]}@example.test`,
          `${manifest.ids["core-jordan"]}@example.test`,
        ].sort()
      );
      assert.ok(
        deliveries.every(
          (delivery) => delivery.subject === "Final orientation invitation"
        )
      );
      const effects = store.writesSince(before, manifest).length;
      assert.equal((await post(final, "confirm")).status, 200);
      assert.equal((await post(final, "retry")).status, 200);
      assert.equal(
        deliveries.length,
        3,
        "confirmation/retry replay must not resend"
      );
      assert.equal(
        store.writesSince(before, manifest).length,
        effects,
        "replay must not duplicate domain effects"
      );
      store.revoke(manifest);
      assert.equal(
        (await post(final, "confirm")).status,
        401,
        "a revoked session cannot confirm an existing plan"
      );
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
