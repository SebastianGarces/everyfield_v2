import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import type { Article } from "./types";
import { toArticle } from "./types";
import { getArticleBySlug } from "./service";
import { mdxComponents } from "@/components/wiki/mdx-components";

/**
 * Get a single article by slug
 */
export async function getArticle(slug: string): Promise<Article | null> {
  const dbArticle = await getArticleBySlug(slug, null);

  if (!dbArticle) {
    return null;
  }

  // Extract section from slug (e.g., "discovery/defining-your-church-values" -> "discovery")
  const sectionSlug = slug.split("/")[0] ?? "";

  return toArticle(dbArticle, sectionSlug);
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
    currentPath += `/${segment}`;
    breadcrumbs.push({
      label: formatSegment(segment),
      href: currentPath,
    });
  }

  // Add current article
  breadcrumbs.push({
    label: title,
    href: `/wiki/${slug}`,
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
