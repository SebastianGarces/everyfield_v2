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
// THE TABLE LIVES IN A CARD, AND THE CARD IS CAPPED. Left fluid, a roster of
// one or two rows was a header rule stretched across ~2000px with the names
// stranded at one end and the counts at the other — the comparison the table
// exists for was a saccade wide. `max-w-4xl` keeps the widest realistic name
// beside its numbers; the card gives the rows a surface to sit on instead of
// floating on the shell's background.
//
// THE SUMMARY IS THE HEADLINE, NOT A FOOTNOTE. "4 sending churches · 17 plants
// · 3 invitations awaiting a reply" is the answer most visits come for, and it
// was set in the same small muted gray as the caveat below the table. It now
// leads the card in ink at the weight its content deserves; the table is the
// breakdown behind it.
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
  canInvite,
}: {
  sendingChurches: NetworkSendingChurchSummary[];
  /**
   * WHETHER THIS READER MAY ACTUALLY SEND THAT INVITATION (#500).
   *
   * The empty state's call to action is a promise, and an org MEMBER cannot
   * keep it — `org.invitation.manage` is Owner-only, so the form behind the
   * link is not rendered for them. Without this the emptiest screen in the
   * product would hand a Member the one control they may not use.
   */
  canInvite: boolean;
}) {
  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1
          id={ROSTER_HEADING_ID}
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Sending churches
        </h1>
        {/*
          Ink, not the muted role: on the shell's `bg-background` muted measures
          4.39:1, below WCAG AA for normal text. Size carries the subordination.
        */}
        <p className="text-foreground max-w-2xl text-sm text-pretty">
          Every sending church in your network, with the plants it accounts for
          and the invitations it is still waiting on.
        </p>
      </header>

      {sendingChurches.length === 0 ? (
        <EmptyRoster canInvite={canInvite} />
      ) : (
        <div className="bg-card max-w-4xl overflow-hidden rounded-xl border shadow-sm">
          <div className="border-b px-6 py-5">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              In your network
            </p>
            <p className="text-foreground mt-1 text-base font-semibold tabular-nums">
              {summarizeSendingChurchRoster(sendingChurches)}
            </p>
          </div>

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
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Sending church</TableHead>
                <TableHead className="w-40 text-right">Church plants</TableHead>
                <TableHead className="w-48 pr-6 text-right">
                  Pending invitations
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sendingChurches.map((sendingChurch) => (
                <TableRow
                  key={sendingChurch.sendingChurchId}
                  className="last:border-b-0"
                >
                  <TableCell className="text-foreground py-3 pl-6 font-medium">
                    {sendingChurch.name}
                  </TableCell>
                  {/*
                    A zero is rendered as "0", never as an em dash or a blank:
                    "this sending church has no plants yet" is a fact the
                    network admin is here to read, and a blank cell makes them
                    guess whether the number failed to load.
                  */}
                  <TableCell className="text-foreground py-3 text-right font-medium tabular-nums">
                    {sendingChurch.plantCount}
                  </TableCell>
                  <TableCell className="text-foreground py-3 pr-6 text-right font-medium tabular-nums">
                    {sendingChurch.pendingInvitationCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p
            id={ROSTER_NOTE_ID}
            className="text-muted-foreground border-t px-6 py-4 text-sm text-pretty"
          >
            Plant counts cover plants associated with your network. Pending
            invitations are the ones a sending church has sent that have not
            been answered and have not expired.
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyRoster({ canInvite }: { canInvite: boolean }) {
  return (
    <div className="bg-card max-w-4xl rounded-xl border border-dashed p-10 text-center">
      <h2 className="font-semibold">No sending churches yet</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm text-pretty">
        A sending church appears here once it accepts an invitation from your
        network.
      </p>
      {canInvite && (
        <p className="mt-4 text-sm">
          <Link
            href="/oversight/invitations"
            className="text-primary cursor-pointer font-medium underline underline-offset-4"
          >
            Invite a sending church
          </Link>
        </p>
      )}
    </div>
  );
}
