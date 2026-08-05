// ============================================================================
// SendingChurchesRoster — `/oversight/sending-churches` (OV-009), minus auth
// and data access.
//
// Presentational and pure: it receives the already-scoped roster from the page,
// which owns the network-only guard and the read. Nothing here decides who may
// see a sending church.
//
// A TABLE, not a grid of cards: every row carries the same two numbers, and the
// question the page exists to answer ("which of my sending churches is carrying
// the most, and who is waiting on a reply") is a comparison DOWN a column.
// Cards would put those numbers on different lines at different x-positions and
// make the comparison an act of memory. The counts are `tabular-nums` and
// right-aligned for the same reason — digits that line up compare at a glance.
//
// NO ROW LINKS. There is no per-sending-church page in alpha, and a nav item or
// row that leads nowhere is a 404 with no way back (#260, the rule the sidebar
// lives under). The one link on the surface is the empty state's, to a page
// that exists.
// ============================================================================

import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { summarizeSendingChurchRoster } from "@/lib/oversight/presentation";
import type { NetworkSendingChurchSummary } from "@/lib/oversight/types";

const ROSTER_HEADING_ID = "sending-churches-heading";
const ROSTER_NOTE_ID = "sending-churches-note";

export function SendingChurchesRoster({
  sendingChurches,
}: {
  sendingChurches: NetworkSendingChurchSummary[];
}) {
  return (
    <div className="space-y-8 p-6">
      <header className="space-y-2">
        <h1
          id={ROSTER_HEADING_ID}
          className="text-3xl font-bold tracking-tight"
        >
          Sending churches
        </h1>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          Every sending church in your network, with the plants it accounts for
          and the invitations it is still waiting on.
        </p>
      </header>

      {sendingChurches.length === 0 ? (
        <EmptyRoster />
      ) : (
        <section className="space-y-3">
          <p className="text-muted-foreground text-sm tabular-nums">
            {summarizeSendingChurchRoster(sendingChurches)}
          </p>
          <div className="rounded-lg border">
            {/*
              The table is NAMED by the page heading and DESCRIBED by the note
              below it, so a screen-reader user who lands on the table hears
              what it is and how its two counts are defined — the same two facts
              a sighted reader gets from the words above and below it. Without
              them the table announces itself as "table, 3 columns" and the
              caveats sit in prose it may never reach.
            */}
            <Table
              aria-labelledby={ROSTER_HEADING_ID}
              aria-describedby={ROSTER_NOTE_ID}
            >
              <TableHeader>
                <TableRow>
                  <TableHead>Sending church</TableHead>
                  <TableHead className="w-40 text-right">
                    Church plants
                  </TableHead>
                  <TableHead className="w-48 text-right">
                    Pending invitations
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sendingChurches.map((sendingChurch) => (
                  <TableRow key={sendingChurch.sendingChurchId}>
                    <TableCell className="font-medium">
                      {sendingChurch.name}
                    </TableCell>
                    {/*
                      A zero is rendered as "0", never as an em dash or a blank:
                      "this sending church has no plants yet" is a fact the
                      network admin is here to read, and a blank cell makes them
                      guess whether the number failed to load.
                    */}
                    <TableCell className="text-right tabular-nums">
                      {sendingChurch.plantCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sendingChurch.pendingInvitationCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p
            id={ROSTER_NOTE_ID}
            className="text-muted-foreground max-w-2xl text-sm text-pretty"
          >
            Plant counts cover plants associated with your network. Pending
            invitations are the ones a sending church has sent that have not
            been answered and have not expired.
          </p>
        </section>
      )}
    </div>
  );
}

function EmptyRoster() {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h2 className="font-semibold">No sending churches yet</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm text-pretty">
        A sending church appears here once it accepts an invitation from your
        network.
      </p>
      <p className="mt-4 text-sm">
        <Link
          href="/oversight/invitations"
          className="text-primary cursor-pointer underline underline-offset-4"
        >
          Invite a sending church
        </Link>
      </p>
    </div>
  );
}
