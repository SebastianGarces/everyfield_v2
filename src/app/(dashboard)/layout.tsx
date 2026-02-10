import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { DashboardHeader, HeaderProvider } from "@/components/header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WikiGuide } from "@/components/wiki-guide";
import { getCurrentSession } from "@/lib/auth";

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email.substring(0, 2).toUpperCase();
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getCurrentSession();
  const headersList = await headers();
  const isCrawler = headersList.get("x-is-crawler") === "true";

  // For crawlers without auth, render minimal shell for metadata scraping only
  if (!user && isCrawler) {
    return <>{children}</>;
  }

  if (!user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  const sidebarUser = {
    name: user.name || user.email.split("@")[0],
    email: user.email,
    initials: getInitials(user.name, user.email),
    role: user.role,
  };

  const isOversightUser =
    user.role === "sending_church_admin" || user.role === "network_admin";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={sidebarUser} hasChurch={!!user.churchId} />
      <SidebarInset className="flex h-screen flex-col overflow-hidden">
        <HeaderProvider>
          <DashboardHeader />
          <main className="flex-1 overflow-auto">{children}</main>
          {!isOversightUser && <WikiGuide />}
        </HeaderProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
