import { type ReactNode } from "react";

import { Proto429Bench } from "@/components/people/proto-429-bench";

export const dynamic = "force-dynamic";

/**
 * PROTOTYPE ONLY — never merge `Proto429Bench`. It is here for the #429 ruling
 * on the status-badge colour scale (`src/lib/people/status-colors.proto429.ts`),
 * and this is the layout that owns both surfaces the badge appears on: the list
 * at /people and the profile under /people/[id].
 */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full">
      <Proto429Bench />
      {children}
    </div>
  );
}
