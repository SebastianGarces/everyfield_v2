"use client";

type DashboardUser = {
  id: string;
  email: string;
  name: string | null;
  role: "planter" | "coach" | "team_member" | "network_admin";
};

export default function DashboardClient({
  user,
}: {
  user: DashboardUser | null;
}) {
  const message = user
    ? `Welcome back, ${user.name ?? user.email}`
    : "Welcome to EveryField";

  return <p className="text-gray-600">{message}</p>;
}
