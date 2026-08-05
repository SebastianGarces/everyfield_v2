/**
 * Four directions for "how wide is the layout's crawler shell, and what counts
 * as a crawler". Pure modules, one shared interface, no imports from `src/`.
 *
 * The pipeline being modelled is the real one:
 *   proxy(request)  ->  DashboardLayout(request, user)  ->  page(user)
 * Each direction may change only the two decisions under debate: which routes
 * the layout's crawler branch covers, and which User-Agents it recognises.
 */

export type Request = {
  path: string;
  ua: string;
  /** A real session cookie. Every scenario below is logged out except one control. */
  hasSession: boolean;
};

export type Step = { actor: string; detail: string };

export type Outcome = {
  /** What the client finally sees. */
  status: 200 | 307 | 500;
  /** Where a 307 points. */
  location?: string;
  steps: Step[];
};

export type Direction = {
  key: string;
  name: string;
  blurb: string;
  run: (request: Request) => Outcome;
};

/* ------------------------------------------------------------------ */
/* The parts of the app the directions do NOT change                   */
/* ------------------------------------------------------------------ */

/** What `src/proxy.ts` pre-empts. Unchanged in every direction. */
const PROTECTED_ROUTE_PREFIXES = ["/dashboard", "/wiki", "/oversight"];

const isProtectedRoute = (path: string): boolean =>
  PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

/**
 * How each page behaves once the layout has let it render with no session.
 * Read off the real pages: `/wiki/*` renders session-less (that is the whole
 * point of the allowance); `/dashboard` and `/oversight` call
 * `getCurrentSession()` and redirect themselves; the other six call
 * `verifySession()`, which throws.
 */
type PageBehaviour = "renders-sessionless" | "redirects-itself" | "throws";

const PAGES: Record<string, PageBehaviour> = {
  "/wiki/getting-started": "renders-sessionless",
  "/dashboard": "redirects-itself",
  "/oversight": "redirects-itself",
  "/people": "throws",
  "/settings": "throws",
  "/tasks": "throws",
  "/teams": "throws",
  "/meetings": "throws",
  "/notifications": "throws",
};

const pageBehaviour = (path: string): PageBehaviour => PAGES[path] ?? "throws";

const renderPage = (request: Request, steps: Step[]): Outcome => {
  if (request.hasSession) {
    steps.push({ actor: "page", detail: "session present -> renders" });
    return { status: 200, steps };
  }
  switch (pageBehaviour(request.path)) {
    case "renders-sessionless":
      steps.push({
        actor: "page",
        detail: "renders without a session (OG tags present)",
      });
      return { status: 200, steps };
    case "redirects-itself":
      steps.push({
        actor: "page",
        detail: "no session -> redirect('/login')",
      });
      return { status: 307, location: "/login", steps };
    case "throws":
      steps.push({
        actor: "page",
        detail: "verifySession() THROWS -> unhandled -> 500",
      });
      return { status: 500, steps };
  }
};

/* ------------------------------------------------------------------ */
/* Axis 1: which User-Agents count as a crawler                        */
/* ------------------------------------------------------------------ */

const CRAWLER_TOKENS = [
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "telegrambot",
  "whatsapp",
  "applebot",
  "googlebot",
  "bingbot",
  "discordbot",
];

/** Today's rule (main and the PR branch): bare substring match, anywhere. */
const isCrawlerLoose = (ua: string): boolean => {
  const lower = ua.toLowerCase();
  return CRAWLER_TOKENS.some((token) => lower.includes(token));
};

/**
 * Tightened rule: WhatsApp's link-preview fetcher sends a UA that IS
 * `WhatsApp/2.x`; its in-app browser sends a full Chrome UA with a WhatsApp
 * token appended. Anchoring the WhatsApp token to the start of the UA keeps
 * the previewer and drops the human. Every other token is left as-is — none of
 * them appear inside a browser UA.
 */
const isCrawlerTight = (ua: string): boolean => {
  const lower = ua.toLowerCase();
  if (lower.startsWith("whatsapp/")) return true;
  return CRAWLER_TOKENS.filter((token) => token !== "whatsapp").some((token) =>
    lower.includes(token)
  );
};

/* ------------------------------------------------------------------ */
/* The pipeline, parameterised by the two decisions                    */
/* ------------------------------------------------------------------ */

type Rules = {
  isCrawler: (ua: string) => boolean;
  /** Where the LAYOUT is willing to render the session-less crawler shell. */
  layoutShellApplies: (path: string) => boolean;
};

const pipeline = (request: Request, rules: Rules): Outcome => {
  const steps: Step[] = [];
  const crawler = rules.isCrawler(request.ua);

  // --- proxy (identical in all four directions) ---
  if (!request.hasSession && isProtectedRoute(request.path)) {
    if (!crawler) {
      steps.push({
        actor: "proxy",
        detail: "protected route, no session, not a crawler -> 307 /login",
      });
      return { status: 307, location: "/login", steps };
    }
    steps.push({
      actor: "proxy",
      detail: "protected route, crawler UA -> admitted",
    });
  } else {
    steps.push({
      actor: "proxy",
      detail: request.hasSession
        ? "session cookie present -> pass through"
        : "route not in PROTECTED_ROUTE_PREFIXES -> pass through",
    });
  }

  // --- (dashboard) layout ---
  if (request.hasSession) {
    steps.push({ actor: "layout", detail: "session -> full dashboard shell" });
    return renderPage(request, steps);
  }

  if (crawler && rules.layoutShellApplies(request.path)) {
    steps.push({
      actor: "layout",
      detail: "no session + crawler -> bare shell, page renders",
    });
    return renderPage(request, steps);
  }

  steps.push({
    actor: "layout",
    detail: crawler
      ? "crawler, but shell does not apply here -> redirect('/login')"
      : "no session -> redirect('/login')",
  });
  return { status: 307, location: "/login", steps };
};

/* ------------------------------------------------------------------ */
/* The four directions                                                 */
/* ------------------------------------------------------------------ */

export const DIRECTIONS: Direction[] = [
  {
    key: "A",
    name: "Narrow to the proxy's list",
    blurb:
      "Layout renders the crawler shell only under /dashboard, /wiki, /oversight — the routes the proxy admits crawlers to. Everything else in the group redirects. Restores main's behaviour exactly. UA matching unchanged.",
    run: (request) =>
      pipeline(request, {
        isCrawler: isCrawlerLoose,
        layoutShellApplies: isProtectedRoute,
      }),
  },
  {
    key: "B",
    name: "Narrow + tighten the WhatsApp token",
    blurb:
      "A, plus anchor the WhatsApp match to WhatsApp's preview fetcher (UA starts with 'WhatsApp/') so the in-app browser is treated as the human it is — everywhere, including /wiki.",
    run: (request) =>
      pipeline(request, {
        isCrawler: isCrawlerTight,
        layoutShellApplies: isProtectedRoute,
      }),
  },
  {
    key: "C",
    name: "Group-wide, but only where a page can render session-less",
    blurb:
      "Shell applies anywhere in the (dashboard) group, but the layout redirects to /login for any route it is not told renders without a session — an explicit allowlist the layout owns, so a new crawlable route is a deliberate addition rather than an accident.",
    run: (request) =>
      pipeline(request, {
        isCrawler: isCrawlerLoose,
        layoutShellApplies: (path) =>
          pageBehaviour(path) === "renders-sessionless",
      }),
  },
  {
    key: "D",
    name: "Group-wide (the PR as it stands)",
    blurb:
      "Leave it as built: the layout trusts the UA on every route in the group and lets the page decide. Simplest rule, no second list to keep in sync — and six routes answer 500 to anything with a crawler token in its UA.",
    run: (request) =>
      pipeline(request, {
        isCrawler: isCrawlerLoose,
        layoutShellApplies: () => true,
      }),
  },
];

/* ------------------------------------------------------------------ */
/* Scenarios — the contentious cases, preloaded                        */
/* ------------------------------------------------------------------ */

export const UAS = {
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  facebook: "facebookexternalhit/1.1",
  whatsappBot: "WhatsApp/2.23.20.0 A",
  whatsappHuman:
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/;WhatsApp/2.23]",
  chrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;

export type Scenario = {
  key: string;
  name: string;
  why: string;
  requests: Request[];
};

const groupRoutes = [
  "/people",
  "/settings",
  "/tasks",
  "/teams",
  "/meetings",
  "/notifications",
];

export const SCENARIOS: Scenario[] = [
  {
    key: "1",
    name: "The human in WhatsApp's in-app browser",
    why: "The case that made this a spec-question: a logged-out person taps a shared link. 'whatsapp' matches their UA as a bare substring. On main every one of these was a clean 307 to /login.",
    requests: [
      ...groupRoutes.map((path) => ({
        path,
        ua: UAS.whatsappHuman,
        hasSession: false,
      })),
      { path: "/dashboard", ua: UAS.whatsappHuman, hasSession: false },
      {
        path: "/wiki/getting-started",
        ua: UAS.whatsappHuman,
        hasSession: false,
      },
    ],
  },
  {
    key: "2",
    name: "Googlebot crawling the whole group",
    why: "What lands in the search index. Six routes the proxy deliberately never admitted crawlers to are now reachable by anything with a bot UA.",
    requests: [
      ...groupRoutes.map((path) => ({
        path,
        ua: UAS.googlebot,
        hasSession: false,
      })),
      { path: "/dashboard", ua: UAS.googlebot, hasSession: false },
      { path: "/oversight", ua: UAS.googlebot, hasSession: false },
      { path: "/wiki/getting-started", ua: UAS.googlebot, hasSession: false },
    ],
  },
  {
    key: "3",
    name: "The feature that must not regress: link previews",
    why: "The reason the crawler allowance exists at all. Whatever is ruled, a shared /wiki link must still return 200 with OG tags to a real previewer.",
    requests: [
      { path: "/wiki/getting-started", ua: UAS.googlebot, hasSession: false },
      { path: "/wiki/getting-started", ua: UAS.facebook, hasSession: false },
      { path: "/wiki/getting-started", ua: UAS.whatsappBot, hasSession: false },
      { path: "/dashboard", ua: UAS.facebook, hasSession: false },
    ],
  },
  {
    key: "4",
    name: "Ordinary humans (the control)",
    why: "Nothing here may move in any direction: a logged-out browser gets /login, a logged-in one gets the page.",
    requests: [
      { path: "/people", ua: UAS.chrome, hasSession: false },
      { path: "/dashboard", ua: UAS.chrome, hasSession: false },
      { path: "/wiki/getting-started", ua: UAS.chrome, hasSession: false },
      { path: "/people", ua: UAS.chrome, hasSession: true },
      { path: "/people", ua: UAS.whatsappHuman, hasSession: true },
    ],
  },
  {
    key: "5",
    name: "Anyone minting 500s with a UA string",
    why: "curl -A googlebot. Not a data leak — verifySession() throws before any query — but it is free error-log noise and free error pages, from an unauthenticated stranger.",
    requests: groupRoutes.map((path) => ({
      path,
      ua: "curl/8.4.0 googlebot",
      hasSession: false,
    })),
  },
];
