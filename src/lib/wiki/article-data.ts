import type { Article } from "./types";
import { toArticle } from "./types";
import { articleBySlugQuery } from "./get-articles";

export type ArticleWithRelated = Article & {
  relatedArticleSlugs: string[];
};

/** Tenant-scoped article data without pulling the MDX compiler into server runtimes. */
export async function getArticle(
  slug: string,
  churchId: string | null = null
): Promise<ArticleWithRelated | null> {
  const [dbArticle] = await articleBySlugQuery(slug, churchId);
  if (!dbArticle) return null;
  const sectionSlug = slug.split("/")[0] ?? "";
  return {
    ...toArticle(dbArticle, sectionSlug),
    relatedArticleSlugs: dbArticle.relatedArticleSlugs ?? [],
  };
}
