import { NextRequest, NextResponse } from "next/server";
import { getArticle } from "@/lib/wiki";
import { getCurrentSession } from "@/lib/auth";

/**
 * GET /api/wiki/article?slug=frameworks/the-4-cs
 *
 * Returns wiki article data (including raw MDX content) for the
 * WikiGuide panel. The client renders the content using react-markdown.
 * Requires an authenticated session.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const slug = request.nextUrl.searchParams.get("slug");
    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    const article = await getArticle(slug);
    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      slug: article.slug,
      title: article.title,
      description: article.description,
      readTime: article.readTime,
      type: article.type,
      content: article.content,
    });
  } catch (error) {
    console.error("[WikiGuide API] Error fetching article:", error);
    return NextResponse.json(
      { error: "Failed to fetch article" },
      { status: 500 }
    );
  }
}
