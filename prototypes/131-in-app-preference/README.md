# 131 — what does turning OFF the `in_app` channel mean?

PR #223 records a disabled channel in `notification_deliveries` as `suppressed_by_preference`
(AC3, verified). For `email` that recording IS the effect — nothing is sent. For `in_app` it is
not: the FRD makes the queue row and the feed row the same record, and `feedVisibility` /
`unreadCountQuery` in `src/lib/notifications/queries.ts` never look at `notification_deliveries`.
So a user who turns `tasks` in-app off — a case N-005 names explicitly — still sees every one of
those notifications in the feed and in the unread badge. The only trace of their choice is a
delivery-log row nobody reads.

This prototype makes the four candidate meanings operable. Each direction implements the same
interface (`enqueue` → `dispatch` → `feed` / `unreadCount`), so the same action log replays through
all four and you can flip between them on one keypress.

A second question rides along and is toggleable with `[x]`: when EVERY channel was suppressed,
`statusFromChannelResults` today returns `delivered`. Is a notification the user opted out of
"delivered", or does it need its own terminal status?

Throwaway. Nothing here merges — the winning direction is a spec, not code to lift.

Run: `pnpm tsx prototypes/131-in-app-preference/cli.ts`
