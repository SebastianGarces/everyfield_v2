import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/actions";
import { getCurrentSession } from "@/lib/auth";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const { user } = await getCurrentSession();
  const clientUser = user
    ? {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        role: user.role,
      }
    : null;

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="mb-6 text-3xl font-bold">Dashboard</h1>
        <DashboardClient user={clientUser} />
      </div>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </div>
  );
}
