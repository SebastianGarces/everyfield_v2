import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { storedImageResponse } from "@/lib/stored-image-response";

// The S3 client needs the Node.js runtime.
export const runtime = "nodejs";

/**
 * GET /api/account/avatar
 *
 * THE ONLY READ PATH FOR AN ACCOUNT'S PROFILE PICTURE (CS-004, #617).
 *
 * `users.avatar_key` holds a private-bucket key, and this route is what turns
 * one into pixels. The object has no other address a browser can reach, and no
 * signed URL is ever minted for it — a signed URL is a bearer token, so handing
 * one to the page would make the picture readable by anyone who copied it out of
 * the markup.
 *
 * NO ACCOUNT ID IN THE PATH, and that is the whole authorization story. The
 * person route next door needs one because a planter reads OTHER people's
 * photos, and it pays for that with a church-scoped lookup; an account only ever
 * reads its own, so the session names the row and there is no id to forge, to
 * enumerate, or to check. Whose picture this is is not a parameter — the same
 * property the Account section's writes have (`memory/invariants.md` →
 * Authentication).
 *
 * So there are two refusals and this file holds only the first: no session is
 * 401, and everything after it — no stored key, or a row naming an object the
 * bucket no longer has — is `storedImageResponse`'s 404, which is what makes the
 * initials fallback render instead of a broken image. That function is shared
 * with the person photo route: the two differ entirely in who may read and not
 * at all in what a key turns into.
 *
 * THE KEY IS READ OFF THE SESSION ROW, not queried again: `getCurrentSession`
 * joins `users` and is request-cached, so the freshest value this request can
 * see is already in hand. A write elsewhere calls `refresh()`, which makes the
 * NEXT request — and this address changes with the key anyway (`userAvatarSrc`
 * busts the cache with the key's uuid), so a stale render cannot point here and
 * get the face that was just replaced.
 */
export async function GET() {
  const { user } = await getCurrentSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return storedImageResponse(user.avatarKey);
}
