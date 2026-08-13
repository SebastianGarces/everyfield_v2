import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import type { Article } from "./types";
import { toArticle } from "./types";
import { articleBySlugQuery } from "./get-articles";
import { encodeWikiSlug, wikiHref } from "./href";
import { mdxComponents } from "@/components/wiki/mdx-components";

/**
 * An article plus the raw cross-link list the row carries (W-009).
 *
 * `relatedArticleSlugs` stays UNRESOLVED here — it is plain text with no
 * foreign key behind it, and turning it into articles needs the visible corpus
 * (`getArticleNavigation` in `get-articles.ts`). Normalised to `[]` so callers
 * never branch on null, and kept off `ArticleMeta` because a list card has no
 * use for it.
 */
export type ArticleWithRelated = Article & {
  relatedArticleSlugs: string[];
};

/**
 * Get a single article by slug, scoped to a church.
 *
 * Until #317 this passed a hardcoded `null`, which made every church-scoped
 * article unreachable — including to the church that owns it. It now reads
 * "global OR mine" (see the tenancy header in `get-articles.ts`), with the
 * church's own copy of a slug winning over the global one of the same name.
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export async function getArticle(
  slug: string,
  churchId: string | null = null
): Promise<ArticleWithRelated | null> {
  // Same override rule as the lists and as search, one implementation: the
  // statement itself suppresses the global row of a slug this church has
  // published its own copy of, so this read returns the winner (#411).
  const [dbArticle] = await articleBySlugQuery(slug, churchId);

  if (!dbArticle) {
    return null;
  }

  // Extract section from slug (e.g., "discovery/defining-your-church-values" -> "discovery")
  const sectionSlug = slug.split("/")[0] ?? "";

  return {
    ...toArticle(dbArticle, sectionSlug),
    relatedArticleSlugs: dbArticle.relatedArticleSlugs ?? [],
  };
}

/**
 * Compile and render MDX content
 */
export async function compileArticle(article: Article) {
  const { content } = await compileMDX({
    source: article.content,
    components: mdxComponents,
    options: {
      parseFrontmatter: false,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        // Stamps deduped heading ids (purpose, purpose-1, …) at compile time.
        // `extractHeadings` (src/lib/wiki/toc.ts) mirrors the same
        // github-slugger sequence so TOC anchors always match.
        rehypePlugins: [rehypeSlug],
      },
    },
  });

  return content;
}

/**
 * Get breadcrumb segments from slug
 */
export function getBreadcrumbs(
  slug: string,
  title: string
): { label: string; href: string }[] {
  const segments = slug.split("/");
  const breadcrumbs: { label: string; href: string }[] = [
    { label: "Wiki", href: "/wiki" },
  ];

  let currentPath = "/wiki";

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    currentPath += `/${encodeWikiSlug(segment)}`;
    breadcrumbs.push({
      label: formatSegment(segment),
      href: currentPath,
    });
  }

  // Add current article
  breadcrumbs.push({
    label: title,
    href: wikiHref(slug),
  });

  return breadcrumbs;
}

function formatSegment(segment: string): string {
  // Handle phase-X format
  if (segment.startsWith("phase-")) {
    const num = segment.replace("phase-", "");
    return `Phase ${num}`;
  }

  // Convert kebab-case to Title Case
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
