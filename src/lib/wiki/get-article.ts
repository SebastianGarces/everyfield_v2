import fs from "fs/promises";
import path from "path";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import type { Article, ArticleMeta } from "./types";
import { mdxComponents } from "@/components/wiki/mdx-components";

const WIKI_DIR = path.join(process.cwd(), "wiki");

/**
 * Parse the comment-style frontmatter from MDX files
 */
function parseFrontmatter(content: string): {
  data: Record<string, string>;
  content: string;
} {
  const match = content.match(/^\{\/\*\s*([\s\S]*?)\s*\*\/\}/);
  if (!match) {
    return { data: {}, content };
  }

  const frontmatterText = match[1];
  const data: Record<string, string> = {};

  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) {
      data[key] = value;
    }
  }

  // Remove frontmatter from content
  const contentWithoutFrontmatter = content.slice(match[0].length).trim();

  return { data, content: contentWithoutFrontmatter };
}

/**
 * Get a single article by slug
 */
export async function getArticle(slug: string): Promise<Article | null> {
  const filePath = path.join(WIKI_DIR, `${slug}.mdx`);

  try {
    const fileContent = await fs.readFile(filePath, "utf-8");
    const { data, content } = parseFrontmatter(fileContent);

    return {
      slug,
      title: data.title || slug,
      type: (data.type as ArticleMeta["type"]) || "reference",
      phase: parseInt(data.phase || "0", 10),
      section: data.section || "",
      order: parseInt(data.order || "999", 10),
      readTime: parseInt(data.read_time || "5", 10),
      description: data.description || "",
      content,
    };
  } catch {
    return null;
  }
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
