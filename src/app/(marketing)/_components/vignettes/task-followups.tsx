import { MeetingCard } from "@/components/meetings/meeting-card";
import { TaskCardView } from "@/components/tasks/task-card-view";

import {
  ACTIVE_TASK_COUNT,
  MEETING_FIXTURE,
  TASK_NOTES,
  tasksFixture,
  tasksFixtureCompact,
} from "./task-followups-fixture";

/**
 * The Tasks panel of the feature switcher — the app's own task rows and
 * meeting card, rendered live.
 *
 * Replaces the r5-tasks.webp crop and the r5-meetcards.webp overlay. The panel
 * makes one causal claim — "meeting attendance creates the follow-up tasks for
 * you, automatically" — so the two halves are the two ends of one story: the
 * meeting card is Vision Night #4, 28 attended and 1 of them new, and the rows
 * under it are the evaluation and the follow-up that night produced. Same
 * church, same week, same numbers the Plant Intelligence assessment on this
 * page cites (see task-followups-fixture.ts).
 *
 * Two compositions, in two different places in the DOM, because the switcher
 * is two different layouts:
 *
 *   - `TaskFollowups` goes in the desktop tab panel (`.fswitch-shot`): four
 *     rows and the meeting card landing on them.
 *   - `TaskFollowupsCompact` goes in the phone stack (`.fstack-shot`): two
 *     REAL rows at full size — the follow-up carrying its pastoral note and
 *     the urgent one due today — inside marketing chrome that carries the
 *     meeting the phone layout drops with the overlay.
 *
 * Server components on purpose, and deliberately NOT wrapped in
 * `VignetteGate`: the panel already sits inside the switcher's own scroll gate
 * (`.fswitch.fs-seen`) and its own tab-switch replay. Nothing here ships a
 * byte of client JS.
 */

/** A still frame of the complete/reopen control.
 *
 * `TaskCardView` takes the checkbox as a slot precisely so a caller can do
 * this: the app passes a Radix `Checkbox` bound to a server action, and the
 * landing page passes a picture of one. Passing the real control would drag a
 * client island — and a focusable button — into a panel that must contain
 * neither. The classes are the unchecked state of `components/ui/checkbox.tsx`
 * verbatim, minus everything that only matters when it can be interacted with.
 *
 * Rendering the slot rather than omitting it also matters visually: an empty
 * slot collapses the row's leading gutter and the rows stop lining up with the
 * ones in the product. */
const CHECKBOX_STILL = (
  <span
    data-slot="checkbox"
    aria-hidden
    className="border-input dark:bg-input/30 block size-4 shrink-0 rounded-[4px] border shadow-xs"
  />
);

/** The list is a picture of the product, so it is announced as one — the same
 *  contract as the capture it replaces.
 *
 *  It names only the three rows that are visible at every width. The fourth is
 *  dropped below 1200px (marketing.css), and a label that names a row the pane
 *  is not showing is a label that is false at the narrow end. */
const LIST_LABEL =
  "Follow-up tasks on the app's own rows: a Vision Night #4 evaluation three days overdue, a follow-up with Dana Whitfield a day overdue and carrying its pastoral note, and an urgent location to find for Vision Night #5, due today.";

const MEETING_LABEL =
  "Vision Night #4 at the Riveras' home, completed — 28 attended, one of them new. This is the attendance that created the follow-ups.";

const COMPACT_LABEL =
  "Two task rows: the follow-up with Dana Whitfield, a day overdue with the note it was created from, and an urgent location to find for Vision Night #5, due today.";

/**
 * ONE instant per render, handed to the fixture AND to the card.
 *
 * `TaskCardView` requires it (see `TaskCardViewProps.now`), and the fixture
 * counts its due-date offsets from it, so the day a row NAMES and the day the
 * card MEASURES cannot come from two different clock reads — or, as they did
 * until #411's follow-up, from two different calendars. Taken inside the
 * component rather than at module scope so a long-lived server process does not
 * serve last week's "today".
 */
export function TaskFollowups() {
  const now = new Date();
  const tasks = tasksFixture(now);

  return (
    <div className="vg-fs vg-fs-tasks">
      <div className="vg-fs-primary">
        <div className="vg-app-embed" role="img" aria-label={LIST_LABEL}>
          {/* `inert` and not just `role="img"`: every row's title is a real
              `next/link` anchor. The attribute takes them out of the tab order
              and out of reach of a pointer. It sits on the inner element
              rather than the labelled one because an inert subtree is dropped
              from the accessibility tree — the label has to live outside it to
              survive. */}
          <div className="vg-inert-layer" inert>
            {/* marketing-owned container, app-owned rows: `vg-fs-stack` is
                where marketing.css sets how many rows the pane is tall enough
                to hold */}
            <div className="vg-fs-stack space-y-2">
              {tasks.map((task) => (
                <TaskCardView
                  key={task.id}
                  task={task}
                  personNote={TASK_NOTES[task.id] ?? null}
                  checkboxSlot={CHECKBOX_STILL}
                  now={now}
                  linkStatic
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* the overlay: the meeting those follow-ups came out of */}
      <div className="vg-fs-overlay vg-fs-meeting">
        <div className="vg-app-embed" role="img" aria-label={MEETING_LABEL}>
          <div className="vg-inert-layer" inert>
            <MeetingCard meeting={MEETING_FIXTURE} isPast linkStatic />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskFollowupsCompact() {
  const now = new Date();
  const tasks = tasksFixtureCompact(now);

  return (
    <div className="vg-fs-m vg-fs-tasks-m">
      <div className="vg-sc-head">
        <span className="vg-label">Tasks</span>
        <span className="vg-asof">{ACTIVE_TASK_COUNT} active</span>
      </div>
      <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
        <div className="vg-inert-layer" inert>
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskCardView
                key={task.id}
                task={task}
                personNote={TASK_NOTES[task.id] ?? null}
                checkboxSlot={CHECKBOX_STILL}
                now={now}
                linkStatic
              />
            ))}
          </div>
        </div>
      </div>
      {/* carries the meeting the phone layout drops with the overlay */}
      <p className="vg-sc-foot">
        Vision Night #4 brought 28 — the follow-ups wrote themselves.
      </p>
    </div>
  );
}
