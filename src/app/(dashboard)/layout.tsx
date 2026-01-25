export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {/* Sidebar and header will be added here */}
      <main className="p-8">{children}</main>
    </div>
  );
}
