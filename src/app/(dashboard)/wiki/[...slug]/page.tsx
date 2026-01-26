import { notFound } from "next/navigation";
import { Clock, FileText } from "lucide-react";
import { getArticle, compileArticle, getBreadcrumbs, getArticles } from "@/lib/wiki";
import { WikiBreadcrumb } from "@/components/wiki/wiki-breadcrumb";

type Props = {
  params: Promise<{ slug: string[] }>;
};

export async function generateStaticParams() {
  const articles = await getArticles();
  return articles.map((article) => ({
    slug: article.slug.split("/"),
  }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const slugPath = slug.join("/");
  const article = await getArticle(slugPath);

  if (!article) {
    return {
      title: "Article Not Found",
    };
  }

  return {
    title: article.title,
    description: article.description,
  };
}

export default async function WikiArticlePage({ params }: Props) {
  const { slug } = await params;
  const slugPath = slug.join("/");
  const article = await getArticle(slugPath);

  if (!article) {
    notFound();
  }

  const content = await compileArticle(article);
  const breadcrumbs = getBreadcrumbs(article.slug, article.title);

  return (
    <article className="space-y-6">
      {/* Breadcrumb */}
      <WikiBreadcrumb items={breadcrumbs} />

      {/* Header */}
      <header className="space-y-4 border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight">{article.title}</h1>

        {article.description && (
          <p className="text-lg text-muted-foreground">{article.description}</p>
        )}

        {/* Meta */}
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

      {/* Content */}
      <div className="prose prose-neutral dark:prose-invert max-w-none">
        {content}
      </div>
    </article>
  );
}
