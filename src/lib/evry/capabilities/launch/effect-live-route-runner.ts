import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { mock } from "node:test";
import { NextRequest } from "next/server";

import * as provider from "@/lib/evry/models/provider";
import {
  modelDecision,
  scriptedConversationModel,
} from "../model-test-fixtures";

// Preloaded before the proof imports application modules. Only the framework
// request context and model provider are replaced; sessions still verify real
// cookie tokens against the suite's database, including fresh authorization.
export const launchLiveRequests = new AsyncLocalStorage<Request>();
export const launchLiveModel = scriptedConversationModel(
  modelDecision({
    classification: "application_action",
    prepareOriginalRequest: true,
  })
);
export const launchLiveRevalidatedPaths: string[] = [];

function currentRequest() {
  const request = launchLiveRequests.getStore();
  assert.ok(request, "Launch live route has no request context");
  return request;
}

mock.module("next/headers", {
  namedExports: {
    cookies: async () => {
      const request = currentRequest();
      return new NextRequest(request.url, { headers: request.headers }).cookies;
    },
    headers: async () => currentRequest().headers,
  },
});
mock.module("next/cache", {
  namedExports: {
    revalidatePath: (path: string) => launchLiveRevalidatedPaths.push(path),
  },
});
mock.module("@/lib/evry/models/provider", {
  namedExports: {
    ...provider,
    getEvryPolicyModel: () => launchLiveModel.model,
  },
});

export function launchLiveRoute(request: Request): Promise<Response> {
  return launchLiveRequests.run(request, async () => {
    const path = new URL(request.url).pathname;
    if (path === "/api/evry/conversations") {
      const { POST } = await import("@/app/api/evry/conversations/route");
      return POST(request);
    }
    const planRoute = /^\/api\/evry\/plans\/([^/]+)\/(confirm|execute)$/.exec(
      path
    );
    assert.ok(planRoute, `Unknown Launch live route: ${path}`);
    const context = { params: Promise.resolve({ planId: planRoute[1]! }) };
    if (planRoute[2] === "confirm") {
      const { POST } =
        await import("@/app/api/evry/plans/[planId]/confirm/route");
      return POST(request, context);
    }
    const { POST } =
      await import("@/app/api/evry/plans/[planId]/execute/route");
    return POST(request, context);
  });
}
