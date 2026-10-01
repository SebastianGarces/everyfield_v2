import { listRecordCorrections } from "@/lib/corrections/history";
import Link from "next/link";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { listLocations } from "@/lib/meetings/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveLocationFormAction,
  archiveLocationFormAction,
  restoreLocationFormAction,
} from "../actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; archived?: string }>;
}) {
  const { user } = await verifySession();
  if (!user.churchId || !holdsSeatFor(user, "meetings.write")) {
    redirect("/meetings");
  }
  const { error, archived } = await searchParams;
  const locations = await listLocations(user.churchId, archived === "1");
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
      <Link
        className="inline-block cursor-pointer underline"
        href={
          archived === "1"
            ? "/meetings/locations"
            : "/meetings/locations?archived=1"
        }
      >
        {archived === "1"
          ? "Hide archived locations"
          : "Include archived locations"}
      </Link>
      {!locations.length && <p>No active saved locations.</p>}
      {locations.map((location) => (
        <section key={location.id} className="space-y-4 rounded-lg border p-4">
          {!location.isActive && (
            <p className="text-muted-foreground">Archived location</p>
          )}
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
          <form
            action={(location.isActive
              ? archiveLocationFormAction
              : restoreLocationFormAction
            ).bind(null, location.id)}
          >
            <Button type="submit" variant="outline">
              {location.isActive ? "Archive Location" : "Restore Location"}
            </Button>
          </form>
        </section>
      ))}
    </div>
  );
}
