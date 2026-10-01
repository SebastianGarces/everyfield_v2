import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetRequests, users } from "@/db/schema";
import { normalizeAccountEmail, isMailableAddress } from "./account-email";
import { REAL_ATTEMPT_LIMITER, type AttemptLimiter } from "./attempt-limiter";
import { checkRateLimit } from "./rate-limit";
import { hashPassword } from "./password";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
} from "./password-policy";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_LINK_DEAD_MESSAGE,
  PASSWORD_RESET_EXPIRY_MS,
  PASSWORD_RESET_PASSWORD_MAX_LENGTH,
  isPasswordResetToken,
} from "./password-reset-policy";
import {
  sendPasswordResetLink,
  sendPasswordResetNotice,
  type PasswordResetMailDeps,
} from "./password-reset-email";

export function newPasswordResetToken(): string {
  return randomBytes(32).toString("hex");
}
export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Every credential writer acquires the user lock before touching dependent requests. */
export function invalidatePasswordResetRequestsStatement(
  userId: string,
  at: Date
) {
  return db
    .update(passwordResetRequests)
    .set({ consumedAt: at })
    .where(
      and(
        eq(passwordResetRequests.userId, userId),
        isNull(passwordResetRequests.consumedAt)
      )
    );
}

export async function requestPasswordReset({
  requestedEmail,
  ip,
  now = new Date(),
  mail = {},
  limiter = REAL_ATTEMPT_LIMITER,
  deferSend,
}: {
  requestedEmail: string;
  ip: string | null;
  now?: Date;
  mail?: PasswordResetMailDeps;
  limiter?: AttemptLimiter;
  deferSend?: (send: () => Promise<void>) => void;
}): Promise<{ ok: true; message: string }> {
  const response = {
    ok: true as const,
    message: PASSWORD_RESET_REQUEST_MESSAGE,
  };
  const email = normalizeAccountEmail(requestedEmail);
  if (!isMailableAddress(email)) return response;
  try {
    if (
      (await checkRateLimit(email, ip, "password_reset", limiter.count)).limited
    )
      return response;
    // Unknown addresses consume the same limits; provider failure cannot expose account existence.
    await limiter.record(email, ip, "password_reset", false);
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (!user) return response;
    const token = newPasswordResetToken();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRY_MS);
    const [, , inserted] = await db.batch([
      db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update"),
      invalidatePasswordResetRequestsStatement(user.id, now),
      db.execute(sql`insert into password_reset_requests (user_id,token_hash,email_snapshot,password_hash_snapshot,created_at,expires_at)
    select id,${hashPasswordResetToken(token)},lower(email),password_hash,${now.toISOString()}::timestamptz,${expiresAt.toISOString()}::timestamptz
    from users where id=${user.id} and lower(email)=${email} returning user_id`),
    ]);
    if (inserted.rows.length === 0) return response;
    const send = async () => {
      try {
        await sendPasswordResetLink(
          { to: email, recipientName: null, token, expiresAt },
          mail
        );
      } catch {
        /* Mail is best effort; never log tokens or addresses. */
      }
    };
    if (deferSend) deferSend(send);
    else await send();
  } catch {
    /* Same public outcome for storage, throttling, lookup and provider failure. */
  }
  return response;
}

export type PasswordResetOutcome =
  | { ok: true }
  | {
      ok: false;
      field: "password" | "confirmPassword" | null;
      message: string;
    };
export async function resetPassword({
  token,
  password,
  confirmPassword,
  ip,
  now = new Date(),
  mail = {},
  limiter = REAL_ATTEMPT_LIMITER,
}: {
  token: string;
  password: string;
  confirmPassword: string;
  ip: string | null;
  now?: Date;
  mail?: PasswordResetMailDeps;
  limiter?: AttemptLimiter;
}): Promise<PasswordResetOutcome> {
  const dead: PasswordResetOutcome = {
    ok: false,
    field: null,
    message: PASSWORD_RESET_LINK_DEAD_MESSAGE,
  };
  if (!isPasswordResetToken(token)) return dead;
  if (password.length < MIN_PASSWORD_LENGTH)
    return {
      ok: false,
      field: "password",
      message: PASSWORD_TOO_SHORT_MESSAGE,
    };
  if (password.length > PASSWORD_RESET_PASSWORD_MAX_LENGTH)
    return {
      ok: false,
      field: "password",
      message: `Use at most ${PASSWORD_RESET_PASSWORD_MAX_LENGTH} characters`,
    };
  if (password !== confirmPassword)
    return {
      ok: false,
      field: "confirmPassword",
      message: "The passwords do not match",
    };
  const tokenHash = hashPasswordResetToken(token);
  // Reject dead links before expensive password hashing, then recheck everything under the lock.
  const [candidate] = await db
    .select({ id: passwordResetRequests.id })
    .from(passwordResetRequests)
    .innerJoin(users, eq(users.id, passwordResetRequests.userId))
    .where(
      and(
        eq(passwordResetRequests.tokenHash, tokenHash),
        isNull(passwordResetRequests.consumedAt),
        sql`${passwordResetRequests.expiresAt} > ${now.toISOString()}::timestamptz`,
        sql`${passwordResetRequests.expiresAt} > statement_timestamp()`,
        sql`${passwordResetRequests.emailSnapshot} = lower(${users.email})`,
        sql`${passwordResetRequests.passwordHashSnapshot} = ${users.passwordHash}`
      )
    )
    .limit(1);
  if (!candidate) return dead;
  const passwordHash = await hashPassword(password);
  // One statement and one user-row lock: a successful swap is the sole gate for every effect.
  const result = await db.execute(sql`with locked as materialized (
  select u.id,u.email,u.password_hash,u.name from users u join password_reset_requests r on r.user_id=u.id
  where r.token_hash=${tokenHash} for update of u
 ), swapped as (
  update users u set password_hash=${passwordHash},updated_at=${now.toISOString()}::timestamptz
  from locked l,password_reset_requests r
  where u.id=l.id and r.user_id=l.id and r.token_hash=${tokenHash} and r.consumed_at is null
   and r.expires_at>${now.toISOString()}::timestamptz and r.expires_at>statement_timestamp()
   and r.email_snapshot=lower(l.email) and r.password_hash_snapshot=l.password_hash
   and u.password_hash=l.password_hash and lower(u.email)=lower(l.email)
  returning u.id,u.email,u.name
 ), revoked_sessions as (
  delete from sessions where user_id in(select id from swapped) returning id
 ), reset_requests as (
  update password_reset_requests set consumed_at=${now.toISOString()}::timestamptz
  where user_id in(select id from swapped) and consumed_at is null returning id
 ), email_requests as (
  update email_change_requests set consumed_at=${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'
  where user_id in(select id from swapped) and consumed_at is null returning id
 ) select id,email,name from swapped`);
  const account = result.rows[0] as
    | { id: string; email: string; name: string | null }
    | undefined;
  if (!account) return dead;
  try {
    await sendPasswordResetNotice(
      { to: account.email, recipientName: account.name, changedAt: now },
      mail
    );
  } catch {
    /* Committed recovery must survive a notification outage. */
  }
  try {
    await limiter.record(
      normalizeAccountEmail(account.email),
      ip,
      "password_reset",
      true
    );
  } catch {
    /* Credential/session change already committed. */
  }
  return { ok: true };
}
