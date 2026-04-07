import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppBindings, ApiSessionContext, ApiUser } from "@/api/types";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { validateSessionToken } from "@/lib/auth/session";

function toApiUser(
  user: Awaited<ReturnType<typeof validateSessionToken>>["user"]
): ApiUser | null {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    churchId: user.churchId,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export const sessionMiddleware = createMiddleware<AppBindings>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);

    if (token) {
      const result = await validateSessionToken(token);
      const user = toApiUser(result.user);

      if (user) {
        c.set("user", user);

        if (user.churchId) {
          c.set("churchId", user.churchId);
        }
      }
    }

    await next();
  }
);

export function getSessionContext(
  c: Context<AppBindings>
): ApiSessionContext | null {
  const user = c.get("user");
  const churchId = c.get("churchId");

  if (!user || !churchId) {
    return null;
  }

  return { user, churchId };
}
