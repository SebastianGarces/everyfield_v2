# Date & Time Rendering

Why and how, for the Date & Time Rendering rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/datetime.ts`, `src/lib/validations/meetings.ts`

`Intl`, `toLocale*` and date-fns all follow the *runtime's* zone — UTC on the server, the visitor's in the browser. So one `Date` renders one string in SSR markup and another after hydration, and a server-only sibling (an email, a digest) disagrees with the page forever. This is a rendering rule as much as a data rule: a client component formatting a prop with bare `toLocaleDateString` reintroduces it even though the server sent a correct instant.

`z.coerce.date()` is banned for the same reason on the way in: `datetime-local` submits a naive string, and `coerce` interprets it in whatever zone the process happens to run in, so the stored instant would follow the server's `TZ`.

The same argument covers day arithmetic, not just formatting, which is why `MS_PER_DAY`, `toCalendarDate` and `addCalendarDays` live here too (#411). A `date` column holds a calendar day, and every surface renders that day in `APP_TIME_ZONE` — so a write that picks the day from `getFullYear()/getMonth()/getDate()`, the runtime's calendar, names a day the reader will disagree with. `toCalendarDate` spent its first life in `src/lib/tasks/recurrence.ts`; by the time it was the app's answer to "which day is this?", a `"use client"` component was importing a datetime primitive out of the tasks domain and four modules each carried their own spelling of a day in milliseconds. This module imports nothing, so anything — client component included — may reach it.

`launches.target_date` (migration 0032 dropped `churches.launch_date`) is the other wall-clock column beside a meeting's `datetime` — a `yyyy-mm-dd` day that must never be round-tripped through a `Date`, and never subtracted from an instant. See [hierarchical-access.md](hierarchical-access.md) for the day-vs-instant countdown bug that produced.
