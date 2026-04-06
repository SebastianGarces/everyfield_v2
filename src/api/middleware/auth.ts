import type { MiddlewareHandler } from "hono";
import { parse as parseCookieHeader } from "hono/utils/cookie";
import type { ApiAuthContext, ApiEnv } from "@/api/types";
import {
  canAccessChurch,
  getAccessibleChurchIds,
  isOversightUser,
} from "@/lib/auth/access";
import {
  hasApiTokenScope,
  touchApiToken,
  validateApiToken,
} from "@/lib/auth/api-tokens";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { validateSessionToken } from "@/lib/auth/session";

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function getRequestedChurchId(request: Request): string | null {
  const url = new URL(request.url);
  return request.headers.get("x-church-id") ?? url.searchParams.get("churchId");
}

async function authenticateWithBearerToken(
  authorizationHeader: string
): Promise<ApiAuthContext | null> {
  const tokenValue = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  if (!tokenValue) {
    return null;
  }

  const validation = await validateApiToken(tokenValue);
  if (!validation) {
    return null;
  }

  await touchApiToken(validation.token.id);

  return {
    accessibleChurchIds: [validation.token.churchId],
    authMethod: "bearer",
    churchId: validation.token.churchId,
    scopes: validation.token.scopes,
    tokenId: validation.token.id,
    user: validation.user,
  };
}

async function authenticateWithSession(
  request: Request
): Promise<ApiAuthContext | null> {
  const cookieHeader = request.headers.get("cookie");
  const sessionToken = cookieHeader
    ? parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME)[SESSION_COOKIE_NAME]
    : undefined;

  if (!sessionToken) {
    return null;
  }

  const validation = await validateSessionToken(sessionToken);
  if (!validation.session || !validation.user) {
    return null;
  }

  const accessibleChurchIds = await getAccessibleChurchIds(validation.user);
  const requestedChurchId = getRequestedChurchId(request);

  let churchId = validation.user.churchId;
  if (requestedChurchId) {
    const allowed = await canAccessChurch(validation.user, requestedChurchId);
    if (!allowed) {
      return null;
    }
    churchId = requestedChurchId;
  } else if (!churchId && accessibleChurchIds.length === 1) {
    churchId = accessibleChurchIds[0];
  }

  return {
    accessibleChurchIds,
    authMethod: "session",
    churchId,
    scopes: [],
    tokenId: null,
    user: validation.user,
  };
}

export const authMiddleware: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const authorizationHeader = c.req.header("authorization");
  const auth = authorizationHeader?.match(/^Bearer\s+/i)
    ? await authenticateWithBearerToken(authorizationHeader)
    : await authenticateWithSession(c.req.raw);

  if (!auth) {
    return error("Unauthorized", 401);
  }

  c.set("auth", auth);
  await next();
};

export const requireChurchReadAccess: MiddlewareHandler<ApiEnv> = async (
  c,
  next
) => {
  const auth = c.get("auth");

  if (!auth.churchId) {
    return error(
      "A church context is required for this endpoint. Provide x-church-id or churchId when needed.",
      400
    );
  }

  if (auth.authMethod === "session" && isOversightUser(auth.user)) {
    return error(
      "Oversight users can only access aggregate API endpoints.",
      403
    );
  }

  if (auth.authMethod === "bearer" && !hasApiTokenScope(auth.scopes, "read")) {
    return error("Bearer token does not include read scope.", 403);
  }

  await next();
};

export const requireChurchWriteAccess: MiddlewareHandler<ApiEnv> = async (
  c,
  next
) => {
  const auth = c.get("auth");

  if (!auth.churchId) {
    return error(
      "A church context is required for this endpoint. Provide x-church-id or churchId when needed.",
      400
    );
  }

  if (auth.authMethod === "bearer") {
    if (!hasApiTokenScope(auth.scopes, "write")) {
      return error("Bearer token does not include write scope.", 403);
    }

    await next();
    return;
  }

  if (auth.user.role === "coach" || isOversightUser(auth.user)) {
    return error(
      "Your account has read-only access for this API surface.",
      403
    );
  }

  await next();
};

export function getAuthContext(c: {
  get(key: "auth"): ApiAuthContext;
}): ApiAuthContext {
  return c.get("auth");
}

export { getRequestedChurchId };
