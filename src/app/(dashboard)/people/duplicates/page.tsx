import { z } from "zod";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import Link from "next/link";
import { HeaderBreadcrumbs } from "@/components/header";
import { Button } from "@/components/ui/button";
import { requireSeat } from "@/lib/auth/seats";
import { listDuplicatePairs } from "@/lib/people/duplicates";
import { redirect } from "next/navigation";

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string; person?: string }>;
}) {
  const { user } = await requireSeat("read");
  if (!user.churchId) redirect("/dashboard");
  const { after, person } = await searchParams;
  const { pairs, next } = await listDuplicatePairs(
    user.churchId,
    after,
    z.uuid().safeParse(person).success ? person : undefined
  );
  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "People & CRM", href: "/people" },
          { label: "Potential duplicates" },
        ]}
      />
      <PageCanvas scrollLayout="flow" frameClassName="mx-auto w-full max-w-4xl">
        <WorkspacePanel className="space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-semibold">Potential duplicates</h1>
            <p className="text-muted-foreground mt-2">
              Review matching email addresses, names or phone endings. A match
              does not always mean the same person.
            </p>
          </div>
          {pairs.length === 0 ? (
            <p className="rounded-lg border p-6">
              No potential duplicates found.
            </p>
          ) : (
            <ul className="space-y-3">
              {pairs.map((pair) => (
                <li
                  key={pair.key}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
                >
                  <div className="min-w-0 space-y-1">
                    {[pair.left, pair.right].map((person) => (
                      <p key={person.id} className="break-words">
                        <Link
                          className="font-medium underline underline-offset-4"
                          href={`/people/${person.id}`}
                        >
                          {person.firstName} {person.lastName}
                        </Link>
                        <span className="text-muted-foreground">
                          {" "}
                          ·{" "}
                          {person.email || person.phone || "No contact details"}
                        </span>
                      </p>
                    ))}
                    <p className="text-muted-foreground text-sm">
                      Matches:{" "}
                      {[
                        pair.email && "email",
                        pair.name && "name",
                        pair.phone && "last 4 phone digits",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <Button variant="outline" asChild>
                    <Link
                      href={`/people/duplicates/${pair.left.id}/${pair.right.id}`}
                    >
                      Review pair
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-3">
            <Button variant="ghost" asChild>
              <Link href="/people">Back to people</Link>
            </Button>
            {next && (
              <Button variant="outline" asChild>
                <Link
                  href={`/people/duplicates?after=${encodeURIComponent(next)}${person ? `&person=${encodeURIComponent(person)}` : ""}`}
                >
                  Next pairs
                </Link>
              </Button>
            )}
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
