import { listRecordCorrections } from "@/lib/corrections/history";
import Link from "next/link";
import { requireSeat } from "@/lib/auth/seats";
import { listLocations } from "@/lib/meetings/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveLocationFormAction, archiveLocationFormAction } from "../actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireSeat("meetings.write");
  if (!user.churchId) redirect("/meetings");
  const locations = await listLocations(user.churchId);
  const histories = new Map(
    await Promise.all(
      locations.map(
        async (location) =>
          [
            location.id,
            await listRecordCorrections(
              user.churchId!,
              "location",
              location.id
            ),
          ] as const
      )
    )
  );
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/meetings">Back to meetings</Link>
      <h1 className="text-2xl font-semibold">Saved locations</h1>
      <p className="text-muted-foreground">
        Correct saved locations or archive those you no longer use. Existing
        meetings keep their recorded location.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!locations.length && <p>No active saved locations.</p>}
      {locations.map((location) => (
        <section key={location.id} className="space-y-4 rounded-lg border p-4">
          <form
            action={saveLocationFormAction.bind(null, location.id)}
            className="space-y-3"
          >
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={location.updatedAt.toISOString()}
            />
            <Label htmlFor={`name-${location.id}`}>Location name</Label>
            <Input
              id={`name-${location.id}`}
              name="name"
              required
              defaultValue={location.name}
            />
            <Label htmlFor={`address-${location.id}`}>Address</Label>
            <Input
              id={`address-${location.id}`}
              name="address"
              required
              defaultValue={location.address}
            />
            <Button type="submit">Save Correction</Button>
          </form>
          {!!histories.get(location.id)?.length && (
            <details>
              <summary className="cursor-pointer">Correction history</summary>
              <ul className="mt-2 space-y-2 text-sm">
                {histories.get(location.id)!.map((entry) => (
                  <li key={entry.id}>
                    {entry.correctedAt.toISOString().slice(0, 10)}:{" "}
                    {String((entry.before as Record<string, unknown>).name)} →{" "}
                    {String((entry.after as Record<string, unknown>).name)};{" "}
                    {String((entry.before as Record<string, unknown>).address)}{" "}
                    → {String((entry.after as Record<string, unknown>).address)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <form action={archiveLocationFormAction.bind(null, location.id)}>
            <Button type="submit" variant="outline">
              Archive Location
            </Button>
          </form>
        </section>
      ))}
    </div>
  );
}
