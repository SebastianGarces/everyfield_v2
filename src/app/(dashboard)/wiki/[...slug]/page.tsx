import { notFound } from "next/navigation";
import Link from "next/link";
import { Clock, FileText, ChevronRight } from "lucide-react";
import {
  getArticle,
  compileArticle,
  getBreadcrumbs,
  getArticles,
  getArticlesByPrefix,
  getArticlesProgress,
} from "@/lib/wiki";
import { WikiBreadcrumb } from "@/components/wiki/wiki-breadcrumb";
import { ProgressTracker } from "@/components/wiki/progress-tracker";
import { ArticleProgressBadge } from "@/components/wiki/article-progress-badge";
import type { ArticleMeta } from "@/lib/wiki/types";
import type { WikiProgressStatus } from "@/db/schema";

// Force dynamic rendering for progress data
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string[] }>;
};

export async function generateStaticParams() {
  const articles = await getArticles();

  // Generate params for articles
  const articleParams = articles.map((article) => ({
    slug: article.slug.split("/"),
  }));

  // Generate params for section indexes (phase-X and phase-X/section)
  const sectionParams = new Set<string>();
  for (const article of articles) {
    const parts = article.slug.split("/");
    // Add phase-level: e.g., "phase-1"
    if (parts.length >= 1) {
      sectionParams.add(parts[0]);
    }
    // Add section-level: e.g., "phase-1/introduction"
    if (parts.length >= 2) {
      sectionParams.add(`${parts[0]}/${parts[1]}`);
    }
  }

  const indexParams = Array.from(sectionParams).map((path) => ({
    slug: path.split("/"),
  }));

  return [...articleParams, ...indexParams];
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const slugPath = slug.join("/");

  // Try to get article first
  const article = await getArticle(slugPath);
  if (article) {
    return {
      title: article.title,
      description: article.description,
    };
  }

  // Otherwise, generate metadata for section index
  const title = formatPathTitle(slugPath);
  return {
    title: `${title} - Wiki`,
    description: `Browse articles in ${title}`,
  };
}

export default async function WikiPage({ params }: Props) {
  const { slug } = await params;
  const slugPath = slug.join("/");

  // Try to get article first
  const article = await getArticle(slugPath);

  if (article) {
    return <ArticleView article={article} />;
  }

  // Otherwise, try to render section index
  const articles = await getArticlesByPrefix(slugPath);

  if (articles.length === 0) {
    notFound();
  }

  return <SectionIndexView slugPath={slugPath} articles={articles} />;
}

// Article view component
async function ArticleView({ article }: { article: ArticleMeta & { content: string } }) {
  const content = await compileArticle(article);
  const breadcrumbs = getBreadcrumbs(article.slug, article.title);

  return (
    <ProgressTracker slug={article.slug}>
      <article className="space-y-6">
        <WikiBreadcrumb items={breadcrumbs} />

        <header className="space-y-4 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight">{article.title}</h1>

          {article.description && (
            <p className="text-lg text-muted-foreground">{article.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              <span className="capitalize">{article.type}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              <span>{article.readTime} min read</span>
            </div>
          </div>
        </header>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          {content}
        </div>
      </article>
    </ProgressTracker>
  );
}

// Section index view component
async function SectionIndexView({
  slugPath,
  articles,
}: {
  slugPath: string;
  articles: ArticleMeta[];
}) {
  const title = formatPathTitle(slugPath);
  const breadcrumbs = getSectionBreadcrumbs(slugPath);

  // Fetch progress for all articles in this section
  const progressMap = await getArticlesProgress(articles.map((a) => a.slug));

  // Group articles by section if we're at phase level
  const isPhaseLevel = slugPath.split("/").length === 1;
  const groupedArticles = isPhaseLevel
    ? groupArticlesBySection(articles)
    : null;

  return (
    <div className="space-y-6">
      <WikiBreadcrumb items={breadcrumbs} />

      <header className="space-y-2 border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">
          {articles.length} article{articles.length !== 1 ? "s" : ""} in this
          section
        </p>
      </header>

      {groupedArticles ? (
        // Phase-level view: grouped by section
        <div className="space-y-8">
          {Object.entries(groupedArticles).map(([section, sectionArticles]) => (
            <div key={section} className="space-y-3">
              <h2 className="text-xl font-semibold">{formatSectionTitle(section)}</h2>
              <ArticleList articles={sectionArticles} progressMap={progressMap} />
            </div>
          ))}
        </div>
      ) : (
        // Section-level view: flat list
        <ArticleList articles={articles} progressMap={progressMap} />
      )}
    </div>
  );
}

// Article list component
function ArticleList({
  articles,
  progressMap,
}: {
  articles: ArticleMeta[];
  progressMap: Map<string, { status: WikiProgressStatus; scrollPosition: number | null }>;
}) {
  const sortedArticles = [...articles].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

  return (
    <div className="grid gap-3">
      {sortedArticles.map((article) => {
        const progress = progressMap.get(article.slug);
        return (
          <Link
            key={article.slug}
            href={`/wiki/${article.slug}`}
            className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
          >
            <div className="space-y-1">
              <h3 className="font-medium group-hover:text-primary">
                {article.title}
              </h3>
              {article.description && (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {article.description}
                </p>
              )}
              <ArticleProgressBadge
                status={progress?.status ?? "not_started"}
                className="mt-2"
              />
            </div>
            <div className="ml-4 flex shrink-0 items-center gap-3">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                {article.type}
              </span>
              <span className="text-xs text-muted-foreground">
                {article.readTime} min
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// Helper functions
function formatPathTitle(slugPath: string): string {
  const parts = slugPath.split("/");

  if (parts[0]?.startsWith("phase-")) {
    const phaseNum = parts[0].replace("phase-", "");
    const phaseName = getPhaseTitle(parseInt(phaseNum, 10));

    if (parts.length === 1) {
      return `Phase ${phaseNum}: ${phaseName}`;
    }

    if (parts.length === 2) {
      return formatSectionTitle(parts[1]);
    }
  }

  return parts.map((p) => formatSectionTitle(p)).join(" / ");
}

function formatSectionTitle(section: string): string {
  return section
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getPhaseTitle(phase: number): string {
  const names: Record<number, string> = {
    0: "Discovery",
    1: "Core Group Development",
    2: "Launch Team Formation",
    3: "Training & Preparation",
    4: "Pre-Launch",
    5: "Launch Sunday",
    6: "Post-Launch",
  };
  return names[phase] || "Unknown";
}

function getSectionBreadcrumbs(
  slugPath: string
): { label: string; href: string }[] {
  const parts = slugPath.split("/");
  const breadcrumbs: { label: string; href: string }[] = [
    { label: "Wiki", href: "/wiki" },
  ];

  let currentPath = "/wiki";

  for (const part of parts) {
    currentPath += `/${part}`;
    breadcrumbs.push({
      label: part.startsWith("phase-")
        ? `Phase ${part.replace("phase-", "")}`
        : formatSectionTitle(part),
      href: currentPath,
    });
  }

  return breadcrumbs;
}

function groupArticlesBySection(
  articles: ArticleMeta[]
): Record<string, ArticleMeta[]> {
  const grouped: Record<string, ArticleMeta[]> = {};

  for (const article of articles) {
    const section = article.section || "other";
    if (!grouped[section]) {
      grouped[section] = [];
    }
    grouped[section].push(article);
  }

  return grouped;
}
