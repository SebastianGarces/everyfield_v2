import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/**
 * On-demand revalidation endpoint for wiki articles
 *
 * Usage:
 * POST /api/wiki/revalidate
 * Body: { "slug": "discovery/defining-your-church-values", "secret": "your-secret" }
 *
 * This will revalidate the specific article page and the wiki index.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, secret } = body as { slug?: string; secret?: string };

    // Verify secret token for security
    const revalidationSecret = process.env.REVALIDATION_SECRET;
    if (!revalidationSecret || secret !== revalidationSecret) {
      return NextResponse.json(
        { error: "Invalid or missing secret" },
        { status: 401 }
      );
    }

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    // Revalidate the specific article path
    revalidatePath(`/wiki/${slug}`);

    // Also revalidate the wiki index page (navigation might have changed)
    revalidatePath("/wiki");

    return NextResponse.json({
      revalidated: true,
      slug,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Revalidation error:", error);
    return NextResponse.json(
      { error: "Failed to revalidate" },
      { status: 500 }
    );
  }
}

/**
 * Revalidate all wiki pages (use sparingly)
 *
 * Usage:
 * DELETE /api/wiki/revalidate
 * Body: { "secret": "your-secret" }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret } = body as { secret?: string };

    // Verify secret token for security
    const revalidationSecret = process.env.REVALIDATION_SECRET;
    if (!revalidationSecret || secret !== revalidationSecret) {
      return NextResponse.json(
        { error: "Invalid or missing secret" },
        { status: 401 }
      );
    }

    // Revalidate all wiki pages via the layout
    revalidatePath("/wiki", "layout");

    return NextResponse.json({
      revalidated: true,
      scope: "all",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Revalidation error:", error);
    return NextResponse.json(
      { error: "Failed to revalidate" },
      { status: 500 }
    );
  }
}
