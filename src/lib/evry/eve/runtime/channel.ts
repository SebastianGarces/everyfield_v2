import { eveChannel } from "eve/channels/eve";
import { z } from "zod";
import { eveAppAuth } from "./auth";
import { authenticatedSessionOf } from "./auth-policy";
import { eveSessionStore, touchEveSession } from "./session-store";
import { EVE_APP_ROUTES, validateEveMessageRequest } from "./transport-policy";

const acceptedSession = z.object({
  ok: z.literal(true),
  sessionId: z.string().min(1),
  status: z.literal("accepted"),
});

const channel = eveChannel({
  auth: eveAppAuth,
  audience: "private",
  turnPolicy: "queue",
  uploadPolicy: "disabled",
  events: {
    async "message.completed"(_event, _channel, ctx) {
      await touchEveSession(
        ctx.session.id,
        authenticatedSessionOf(ctx.session.auth.current)
      );
    },
  },
});

/** Persist ownership before exposing a newly created id, including bodyless prewarming. */
export const evryEveChannel = {
  ...channel,
  routes: channel.routes
    .filter((route) => EVE_APP_ROUTES.has(`${route.method} ${route.path}`))
    .map((route) => {
      if (
        route.method !== "POST" ||
        !["/eve/v1/session", "/eve/v1/session/:sessionId"].includes(route.path)
      )
        return route;
      return {
        ...route,
        async handler(
          request: Request,
          args: Parameters<typeof route.handler>[1]
        ) {
          const principal = await eveAppAuth(request);
          if (!principal)
            return Response.json(
              { ok: false, error: "Sign in to continue." },
              { status: 401 }
            );
          if (!(await validateEveMessageRequest(request)))
            return Response.json(
              { ok: false, error: "Invalid message request." },
              { status: 400 }
            );
          const response = await route.handler(request, args);
          if (response.ok && route.path === "/eve/v1/session") {
            const body = acceptedSession.parse(await response.clone().json());
            await eveSessionStore.register(
              body.sessionId,
              authenticatedSessionOf(principal)
            );
          }
          return response;
        },
      };
    }),
};
