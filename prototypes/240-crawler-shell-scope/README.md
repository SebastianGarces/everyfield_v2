# 240 — how wide should the layout's crawler shell be?

PR #283 moved the crawler signal out of a forgeable request header and into the request's own
`user-agent`. That fixed the security defect, but it also changed **who the branch fires for**.
On `main` the layout's crawler branch could only fire where the proxy had already admitted a
crawler — `PROTECTED_ROUTE_PREFIXES = ['/dashboard','/wiki','/oversight']`. The layout now derives
the signal itself, so it fires on **every** route in the `(dashboard)` group. Six of those routes
(`/people`, `/settings`, `/tasks`, `/teams`, `/meetings`, `/notifications`) call `verifySession()`,
which throws with no session — so the shell renders and the page 500s where `main` returned a clean
`307 → /login`.

Two questions have to be ruled together, because the second changes how much the first matters:

1. **Scope** — should the crawler shell apply to the whole `(dashboard)` group, or only to the
   routes the proxy actually admits crawlers to?
2. **UA matching** — `CRAWLER_USER_AGENTS` matches the bare substring `whatsapp`, which WhatsApp's
   *in-app browser* carries, not just its link-preview fetcher. So the worst case is not a bot
   seeing a 500; it is a logged-out **human** following a shared link and landing on an error page
   instead of the login form.

`cli.ts` runs the same request matrix through four directions so both axes can be compared on the
same inputs. Throwaway: nothing here merges.
