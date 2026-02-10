import { getCurrentSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChurchCreatedConfetti } from "./church-created-confetti";
import { CreateChurchCard } from "./create-church-card";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ churchCreated?: string }>;
}) {
  const [{ user }, resolvedSearchParams] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);
  const { churchCreated } = resolvedSearchParams;

  // Redirect oversight users to their dedicated dashboard
  if (user?.role === "sending_church_admin" || user?.role === "network_admin") {
    redirect("/oversight");
  }

  const needsChurch = user?.role === "planter" && !user.churchId;

  return (
    <div className="p-6">
      {churchCreated === "true" && <ChurchCreatedConfetti />}
      {needsChurch ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <CreateChurchCard />
        </div>
      ) : (
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back{user?.name ? `, ${user.name}` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}
