import { type ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function TasksLayout({ children }: { children: ReactNode }) {
  return <div className="h-full">{children}</div>;
}
