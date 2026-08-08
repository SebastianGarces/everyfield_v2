# Date & Time Rendering

Why and how, for the Date & Time Rendering rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/datetime.ts`, `src/lib/validations/meetings.ts`

`Intl`, `toLocale*` and date-fns all follow the *runtime's* zone — UTC on the server, the visitor's in the browser. So one `Date` renders one string in SSR markup and another after hydration, and a server-only sibling (an email, a digest) disagrees with the page forever. This is a rendering rule as much as a data rule: a client component formatting a prop with bare `toLocaleDateString` reintroduces it even though the server sent a correct instant.

`z.coerce.date()` is banned for the same reason on the way in: `datetime-local` submits a naive string, and `coerce` interprets it in whatever zone the process happens to run in, so the stored instant would follow the server's `TZ`.

`launches.target_date` (migration 0032 dropped `churches.launch_date`) is the other wall-clock column beside a meeting's `datetime` — a `yyyy-mm-dd` day that must never be round-tripped through a `Date`, and never subtracted from an instant. See [hierarchical-access.md](hierarchical-access.md) for the day-vs-instant countdown bug that produced.
