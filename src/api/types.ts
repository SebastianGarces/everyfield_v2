import type { User } from "@/db/schema";

export type ApiAuthMethod = "session" | "bearer";

export interface ApiAuthContext {
  accessibleChurchIds: string[];
  authMethod: ApiAuthMethod;
  churchId: string | null;
  scopes: string[];
  tokenId: string | null;
  user: User;
}

export interface ApiEnv {
  Variables: {
    auth: ApiAuthContext;
  };
}
