// ============================================================================
// WHERE THE neon-http DRIVER SENDS ITS SQL — the seam that lets a real database
// exist outside Neon (#411, quality round 1).
//
// THE PROBLEM THIS SOLVES. Every race guard migration 0038 adds is only visible
// against a REAL Postgres, so the three suites that assert them
// (`fork-and-token-race.test.ts`, `role-seat-race.test.ts`,
// `subtask-parent-fk.test.ts`, plus `teams-init-race.test.ts` and
// `declaration-race.test.ts` before them) are opt-in behind `LIVE_DB_TESTS=1`.
// They were also unrunnable ANYWHERE: `db` is built with `neon()`, which speaks
// Neon's HTTP protocol and cannot talk to a plain Postgres over TCP, and CI
// pins `DATABASE_URL` at an unreachable placeholder. The assertions existed;
// the seam to run them did not, so five suites had never proven anything.
//
// WHY NOT node-postgres. The obvious fix — pick `drizzle-orm/node-postgres`
// when the URL is not a Neon host — silently changes the semantics under test:
// `db.batch()` exists ONLY on the batching drivers (neon-http, libsql, d1), and
// `assignMember`, `createConfirmationToken` and every other write path here is
// built on it (`memory/invariants.md` → Transactions: neon-http has no
// interactive transactions, so a batch IS the transaction). A live suite run on
// a driver without `batch` would test code the application never executes.
//
// WHAT THIS DOES INSTEAD. Keep the driver; move the endpoint. Neon's HTTP
// protocol is served locally by `ghcr.io/timowilhelm/local-neon-http-proxy` in
// front of any Postgres, so pointing `neonConfig.fetchEndpoint` at it runs the
// SAME driver, the same `db.batch`, the same `ON CONFLICT` SQL, against a
// container. Production is untouched: a real Neon host returns `null` here and
// the driver keeps its own default endpoint.
// ============================================================================

/**
 * Hosts that can never be Neon, so a database reached at one of them must be
 * fronted by a local HTTP proxy for the neon-http driver to speak to it.
 */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "db.localtest.me",
  "host.docker.internal",
]);

/** The port `local-neon-http-proxy` listens on. */
export const NEON_HTTP_PROXY_PORT = 4444;

/**
 * The `neonConfig.fetchEndpoint` this `DATABASE_URL` needs, or `null` when the
 * driver's own default is right (a real Neon host — the production path).
 *
 * `proxyUrl` (`NEON_HTTP_PROXY_URL`) wins whenever it is set, so a proxy on
 * another port or in front of a remote database needs no code change. Nothing
 * here throws: it runs at module scope in every route, so a malformed URL must
 * fall through to the driver's own error, not replace it with a parse failure.
 */
export function localNeonHttpEndpoint(
  databaseUrl: string | undefined,
  proxyUrl?: string
): string | null {
  if (proxyUrl) return proxyUrl;
  if (!databaseUrl) return null;

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return null;
  }

  if (!LOCAL_HOSTS.has(host)) return null;
  return `http://${host}:${NEON_HTTP_PROXY_PORT}/sql`;
}
