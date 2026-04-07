import type { User } from "@/db/schema";

export type ApiUser = Pick<User, "id" | "churchId" | "email" | "name" | "role">;

export type ApiSessionContext = {
  user: ApiUser;
  churchId: string;
};

export type AppBindings = {
  Variables: {
    user?: ApiUser;
    churchId?: string;
  };
};
