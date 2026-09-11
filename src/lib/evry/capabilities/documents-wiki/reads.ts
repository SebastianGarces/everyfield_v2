import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { wikiArticleFeedback, wikiBookmarks, wikiProgress } from "@/db/schema";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import {
  getGeneratedDocument,
  listGeneratedDocumentPage,
} from "@/lib/documents/service";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/templates";
import { getArticle } from "@/lib/wiki/article-data";
import { getArticles } from "@/lib/wiki/get-articles";
import { wikiHref } from "@/lib/wiki/href";
import { searchArticlePage } from "@/lib/wiki/search";

export const DOCUMENTS_WIKI_READ_IDENTITIES = {
  templates: "documents.templates.list",
  history: "documents.history.list",
  download: "documents.history.download",
  search: "wiki.search",
  article: "wiki.article.read",
  navigation: "wiki.navigation.read",
  progress: "wiki.progress.read",
} as const;

const uuid = z.string().uuid();
const nullableCursor = z.string().max(500).nullable();
const slug = z.string().trim().min(1).max(500);
const page = z.number().int().min(1).max(10_000);
const PAGE_ITEMS = 25;
const ARTICLE_CHUNK_CODE_UNITS = 500;

export type DocumentsWikiReadSelection =
  | Readonly<{ kind: "templates" }>
  | Readonly<{ kind: "history"; cursor: string | null }>
  | Readonly<{ kind: "download"; documentId: string }>
  | Readonly<{ kind: "search"; query: string; page: number }>
  | Readonly<{ kind: "article"; slug: string; page: number }>
  | Readonly<{ kind: "navigation"; page: number }>
  | Readonly<{ kind: "progress"; page: number }>;

export function selectDocumentsWikiRead(
  textValue: string
): DocumentsWikiReadSelection | null {
  const text = textValue.trim();
  if (/^list document templates[.!?]*$/i.test(text))
    return { kind: "templates" };
  const history =
    /^show document history(?: after ([A-Za-z0-9_-]+))?[.!?]*$/i.exec(text);
  if (history) return { kind: "history", cursor: history[1] ?? null };
  const download = /^download document ([0-9a-f-]{36})[.!?]*$/i.exec(text);
  if (download && uuid.safeParse(download[1]).success)
    return { kind: "download", documentId: download[1]! };
  const search = /^search wiki:\s*([\s\S]{1,200}?)(?:;\s*page=(\d+))?$/i.exec(
    text
  );
  if (search) {
    const pageNumber = Number(search[2] ?? "1");
    if (page.safeParse(pageNumber).success) {
      return { kind: "search", query: search[1]!.trim(), page: pageNumber };
    }
  }
  const article =
    /^show wiki article:\s*([^;]{1,500})(?:;\s*page=(\d+))?[.!?]*$/i.exec(text);
  if (article) {
    const pageNumber = Number(article[2] ?? "1");
    if (page.safeParse(pageNumber).success)
      return { kind: "article", slug: article[1]!.trim(), page: pageNumber };
  }
  const navigation = /^show wiki navigation(?: page (\d+))?[.!?]*$/i.exec(text);
  if (navigation) {
    const pageNumber = Number(navigation[1] ?? "1");
    if (page.safeParse(pageNumber).success)
      return { kind: "navigation", page: pageNumber };
  }
  const progress = /^show wiki progress(?: page (\d+))?[.!?]*$/i.exec(text);
  if (progress) {
    const pageNumber = Number(progress[1] ?? "1");
    if (page.safeParse(pageNumber).success)
      return { kind: "progress", page: pageNumber };
  }
  return null;
}

function chunkLiteral(value: string): string[] {
  if (value.length === 0) return [""];
  const chunks: string[] = [];
  let current = "";
  for (const point of value) {
    if (current.length + point.length > ARTICLE_CHUNK_CODE_UNITS) {
      chunks.push(current);
      current = "";
    }
    current += point;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function boundedDisplay(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  let result = "";
  for (const point of value) {
    if (result.length + point.length > maximum - 1) break;
    result += point;
  }
  return `${result}…`;
}

function artifactId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const TEMPLATES_READ = defineEvryReadRegistration({
  id: "documents.templates",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.templates,
  inputShape: {},
  async run() {
    return buildEvryReadArtifact({
      title: "Document templates",
      filters: [{ label: "Catalog", value: "Current application catalog" }],
      exclusions: [],
      items: DOCUMENT_TEMPLATES.map((template) => ({
        id: template.id,
        label: template.name,
        facts: [
          { label: "Description", value: template.description },
          { label: "Formats", value: template.formats.join(", ") },
          {
            label: "Merge fields",
            value:
              template.mergeFields.map(({ key }) => key).join(", ") || "None",
          },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: `Open ${template.name}`,
          href: `/documents?template=${encodeURIComponent(template.id)}`,
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open Documents",
          href: "/documents",
        }),
      ],
    });
  },
});

const HISTORY_READ = defineEvryReadRegistration({
  id: "documents.history",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.history,
  inputShape: { cursor: nullableCursor },
  async run({ authorization }, input) {
    const result = await listGeneratedDocumentPage(
      authorization.actor.plantId,
      input.cursor
    );
    return buildEvryReadArtifact({
      title: result
        ? "Generated document history"
        : "Document history cursor is no longer valid",
      filters: [
        { label: "Plant", value: "Current plant" },
        ...(input.cursor ? [{ label: "Cursor", value: input.cursor }] : []),
      ],
      exclusions: result ? [] : [{ reason: "Invalid cursor", count: 1 }],
      items: (result?.items ?? []).map((document) => ({
        id: document.id,
        label: document.templateName,
        facts: [
          { label: "Format", value: document.format },
          { label: "Generated", value: document.createdAt.toISOString() },
          ...(result?.nextCursor && document === result.items.at(-1)
            ? [{ label: "Next cursor", value: result.nextCursor }]
            : []),
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: `Download ${document.filename}`,
          href: `/api/documents/history/${document.id}`,
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open document history",
          href: "/documents/history",
        }),
      ],
    });
  },
});

const DOWNLOAD_READ = defineEvryReadRegistration({
  id: "documents.download",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.download,
  inputShape: { documentId: uuid },
  async run({ authorization }, input) {
    const document = await getGeneratedDocument(
      authorization.actor.plantId,
      input.documentId
    );
    return buildEvryReadArtifact({
      title: document ? "Document download ready" : "Document not found",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: document
        ? []
        : [{ reason: "Not found in this plant", count: 1 }],
      items: document
        ? [
            {
              id: document.id,
              label: document.templateId,
              facts: [{ label: "Format", value: document.format }],
              sourceLink: trustedEvryApplicationSourceLink({
                label: "Download document",
                href: `/api/documents/history/${document.id}`,
              }),
            },
          ]
        : [],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open document history",
          href: "/documents/history",
        }),
      ],
    });
  },
});

const SEARCH_READ = defineEvryReadRegistration({
  id: "wiki.search",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.search,
  inputShape: { query: z.string().trim().min(1).max(200), page },
  async run({ authorization }, input) {
    const result = await searchArticlePage(
      input.query,
      authorization.actor.plantId,
      input.page
    );
    return buildEvryReadArtifact({
      title: "Wiki search results",
      filters: [
        { label: "Search", value: input.query },
        { label: "Page", value: String(input.page) },
        { label: "Corpus", value: "Global and current plant" },
      ],
      exclusions: [],
      items: result.items.map((article, index) => ({
        id: article.id,
        label: boundedDisplay(article.title, 160),
        facts: [
          {
            label: "Excerpt",
            value: boundedDisplay(article.excerpt ?? "No excerpt", 500),
          },
          {
            label: "Read time",
            value: `${article.readTimeMinutes ?? 5} minutes`,
          },
          ...(result.hasNextPage && index === result.items.length - 1
            ? [
                {
                  label: "Next page",
                  value: `Search wiki: ${input.query}; page=${input.page + 1}`,
                },
              ]
            : []),
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: boundedDisplay(`Open ${article.title}`, 160),
          href: wikiHref(article.slug),
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({ label: "Open Wiki", href: "/wiki" }),
      ],
    });
  },
});

const ARTICLE_READ = defineEvryReadRegistration({
  id: "wiki.article",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.article,
  inputShape: { slug, page },
  async run({ authorization }, input) {
    const article = await getArticle(input.slug, authorization.actor.plantId);
    const [feedback] = article
      ? await db
          .select({ rating: wikiArticleFeedback.rating })
          .from(wikiArticleFeedback)
          .where(
            and(
              eq(wikiArticleFeedback.churchId, authorization.actor.plantId),
              eq(wikiArticleFeedback.userId, authorization.actor.userId),
              eq(wikiArticleFeedback.articleSlug, article.slug)
            )
          )
          .limit(1)
      : [];
    const chunks = article ? chunkLiteral(article.content) : [];
    const content = chunks[input.page - 1];
    return buildEvryReadArtifact({
      title: article
        ? boundedDisplay(article.title, 200)
        : "Wiki article not found",
      filters: [
        { label: "Article", value: input.slug },
        { label: "Page", value: `${input.page} of ${chunks.length || 0}` },
      ],
      exclusions:
        article && content !== undefined
          ? []
          : [
              {
                reason: article
                  ? "Page is outside this article"
                  : "Not found in the visible corpus",
                count: 1,
              },
            ],
      items:
        article && content !== undefined
          ? [
              {
                id: artifactId(`${article.slug}:page:${input.page}`),
                label: boundedDisplay(
                  `${article.title} · page ${input.page} of ${chunks.length}`,
                  160
                ),
                facts: [
                  { label: "Literal content", value: content },
                  {
                    label: "Your feedback",
                    value: feedback?.rating ?? "Not rated",
                  },
                ],
                sourceLink: trustedEvryApplicationSourceLink({
                  label: boundedDisplay(`Open ${article.title}`, 160),
                  href: wikiHref(article.slug),
                }),
              },
            ]
          : [],
      sourceLinks: article
        ? [
            trustedEvryApplicationSourceLink({
              label: boundedDisplay(`Open ${article.title}`, 160),
              href: wikiHref(article.slug),
            }),
          ]
        : [
            trustedEvryApplicationSourceLink({
              label: "Open Wiki",
              href: "/wiki",
            }),
          ],
    });
  },
});

const NAVIGATION_READ = defineEvryReadRegistration({
  id: "wiki.navigation",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.navigation,
  inputShape: { page },
  async run({ authorization }, input) {
    const articles = await getArticles(authorization.actor.plantId);
    const start = (input.page - 1) * PAGE_ITEMS;
    const pageItems = articles.slice(start, start + PAGE_ITEMS);
    return buildEvryReadArtifact({
      title: "Wiki navigation",
      filters: [
        {
          label: "Page",
          value: `${input.page} of ${Math.max(1, Math.ceil(articles.length / PAGE_ITEMS))}`,
        },
        { label: "Corpus", value: "Global and current plant" },
      ],
      exclusions: [],
      items: pageItems.map((article) => ({
        id: artifactId(article.slug),
        label: boundedDisplay(article.title, 160),
        facts: [
          { label: "Section", value: article.section },
          { label: "Type", value: article.type },
          {
            label: "Phase",
            value: article.phase === null ? "None" : String(article.phase),
          },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: boundedDisplay(`Open ${article.title}`, 160),
          href: wikiHref(article.slug),
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({ label: "Open Wiki", href: "/wiki" }),
      ],
    });
  },
});

const PROGRESS_READ = defineEvryReadRegistration({
  id: "wiki.progress",
  capabilityIdentity: DOCUMENTS_WIKI_READ_IDENTITIES.progress,
  inputShape: { page },
  async run({ authorization }, input) {
    const articles = await getArticles(authorization.actor.plantId);
    const start = (input.page - 1) * PAGE_ITEMS;
    const visible = articles.slice(start, start + PAGE_ITEMS);
    const slugs = visible.map(({ slug: value }) => value);
    const [progressRows, bookmarks] =
      slugs.length === 0
        ? [[], []]
        : await Promise.all([
            db
              .select()
              .from(wikiProgress)
              .where(
                and(
                  eq(wikiProgress.userId, authorization.actor.userId),
                  inArray(wikiProgress.articleSlug, slugs)
                )
              ),
            db
              .select()
              .from(wikiBookmarks)
              .where(
                and(
                  eq(wikiBookmarks.userId, authorization.actor.userId),
                  inArray(wikiBookmarks.articleSlug, slugs)
                )
              ),
          ]);
    const progressBySlug = new Map(
      progressRows.map((row) => [row.articleSlug, row])
    );
    const bookmarked = new Set(bookmarks.map((row) => row.articleSlug));
    return buildEvryReadArtifact({
      title: "Wiki reading progress",
      filters: [
        {
          label: "Page",
          value: `${input.page} of ${Math.max(1, Math.ceil(articles.length / PAGE_ITEMS))}`,
        },
        { label: "Reader", value: "Current user" },
      ],
      exclusions: [],
      items: visible.map((article) => {
        const progress = progressBySlug.get(article.slug);
        return {
          id: artifactId(article.slug),
          label: boundedDisplay(article.title, 160),
          facts: [
            { label: "Status", value: progress?.status ?? "not_started" },
            {
              label: "Scroll position",
              value: String(progress?.scrollPosition ?? 0),
            },
            {
              label: "Bookmarked",
              value: bookmarked.has(article.slug) ? "Yes" : "No",
            },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: boundedDisplay(`Open ${article.title}`, 160),
            href: wikiHref(article.slug),
          }),
        };
      }),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open wiki progress",
          href: "/wiki/progress",
        }),
      ],
    });
  },
});

export const DOCUMENTS_WIKI_READ_REGISTRATIONS = [
  TEMPLATES_READ,
  HISTORY_READ,
  DOWNLOAD_READ,
  SEARCH_READ,
  ARTICLE_READ,
  NAVIGATION_READ,
  PROGRESS_READ,
] as const;

export const continueDocumentsWikiRead = createEvryReadContinuation({
  registrations: DOCUMENTS_WIKI_READ_REGISTRATIONS,
  async select({ literalUserText, eligibleReadIds }) {
    const selection = selectDocumentsWikiRead(literalUserText);
    if (!selection) return null;
    const selected = (() => {
      switch (selection.kind) {
        case "templates":
          return { registration: TEMPLATES_READ, input: {} };
        case "history":
          return {
            registration: HISTORY_READ,
            input: { cursor: selection.cursor },
          };
        case "download":
          return {
            registration: DOWNLOAD_READ,
            input: { documentId: selection.documentId },
          };
        case "search":
          return {
            registration: SEARCH_READ,
            input: { query: selection.query, page: selection.page },
          };
        case "article":
          return {
            registration: ARTICLE_READ,
            input: { slug: selection.slug, page: selection.page },
          };
        case "navigation":
          return {
            registration: NAVIGATION_READ,
            input: { page: selection.page },
          };
        case "progress":
          return {
            registration: PROGRESS_READ,
            input: { page: selection.page },
          };
      }
    })();
    return eligibleReadIds.includes(selected.registration.id)
      ? { readId: selected.registration.id, input: selected.input }
      : null;
  },
});
