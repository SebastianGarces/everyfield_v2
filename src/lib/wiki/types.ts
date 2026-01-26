export type ArticleType = "overview" | "reference" | "how-to" | "tutorial";

export type ArticleCategory =
  | "journey"
  | "reference"
  | "resources"
  | "getting-started"
  | "frameworks";

export type ArticleMeta = {
  slug: string;
  title: string;
  type: ArticleType;
  phase: number;
  section: string;
  order: number;
  readTime: number;
  description: string;
  category: ArticleCategory;
};

export type Article = ArticleMeta & {
  content: string;
};

export type ArticleNavItem = {
  title: string;
  slug: string;
  href: string;
  phase?: number;
  section?: string;
  children?: ArticleNavItem[];
};

export type ArticleNavSection = {
  title: string;
  slug: string;
  items: ArticleNavItem[];
};

export type NavGroup = {
  title: string;
  slug: string;
  sections: ArticleNavSection[];
};
