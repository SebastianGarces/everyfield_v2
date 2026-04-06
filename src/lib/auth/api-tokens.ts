import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, users, type ApiToken, type User } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";

export const apiTokenScopes = ["read", "read:write"] as const;
export type ApiTokenScope = (typeof apiTokenScopes)[number];

export interface CreateApiTokenInput {
  userId: string;
  churchId: string;
  name: string;
  scopes: ApiTokenScope[];
  expiresAt?: Date | null;
}

export interface ApiTokenValidationResult {
  token: ApiToken;
  user: User;
}

const API_TOKEN_DELIMITER = ".";

function createTokenSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function parseCompositeToken(
  value: string
): { tokenId: string; secret: string } | null {
  const separatorIndex = value.indexOf(API_TOKEN_DELIMITER);
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  return {
    tokenId: value.slice(0, separatorIndex),
    secret: value.slice(separatorIndex + 1),
  };
}

export async function createApiToken(
  input: CreateApiTokenInput
): Promise<{ token: ApiToken; plaintextToken: string }> {
  const secret = createTokenSecret();
  const tokenHash = await hashPassword(secret);

  const [token] = await db
    .insert(apiTokens)
    .values({
      userId: input.userId,
      churchId: input.churchId,
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
      tokenHash,
    })
    .returning();

  return {
    token,
    plaintextToken: `${token.id}${API_TOKEN_DELIMITER}${secret}`,
  };
}

export async function validateApiToken(
  plaintextToken: string
): Promise<ApiTokenValidationResult | null> {
  const parsed = parseCompositeToken(plaintextToken.trim());
  if (!parsed) {
    return null;
  }

  const result = await db
    .select({
      token: apiTokens,
      user: users,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(eq(apiTokens.id, parsed.tokenId))
    .limit(1);

  const row = result[0];
  if (!row) {
    return null;
  }

  const isValid = await verifyPassword(row.token.tokenHash, parsed.secret);
  if (!isValid) {
    return null;
  }

  if (row.token.expiresAt && row.token.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return row;
}

export async function touchApiToken(tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));
}

export function hasApiTokenScope(
  scopes: string[],
  requiredScope: "read" | "write"
): boolean {
  if (requiredScope === "read") {
    return scopes.includes("read") || scopes.includes("read:write");
  }

  return scopes.includes("read:write");
}
