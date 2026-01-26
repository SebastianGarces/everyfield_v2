"use server";

import { redirect } from "next/navigation";
import {
  getCurrentSession,
  invalidateSession,
  deleteSessionCookie,
} from "@/lib/auth";

export async function logout(): Promise<void> {
  const { session } = await getCurrentSession();

  if (session) {
    await invalidateSession(session.id);
  }

  await deleteSessionCookie();
  redirect("/login");
}
