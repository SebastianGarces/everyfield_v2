"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { resolveGuideEntry, type WikiGuideEntry } from "@/lib/wiki/guide-config";

export type WikiGuideArticle = {
  slug: string;
  title: string;
  description: string;
  readTime: number;
  type: string;
  content: string;
};

type WikiGuideContextValue = {
  /** Whether the current page has a mapped wiki guide entry */
  isAvailable: boolean;
  /** The resolved guide entry for the current page (null if none) */
  entry: WikiGuideEntry | null;
  /** Whether the panel is open */
  isOpen: boolean;
  /** Toggle the panel open/closed */
  toggle: () => void;
  /** Close the panel */
  close: () => void;
  /** Open the panel */
  open: () => void;
  /** The currently active article slug (for multi-article entries) */
  activeSlug: string | null;
  /** Set the active article slug */
  setActiveSlug: (slug: string) => void;
  /** Fetched article data */
  article: WikiGuideArticle | null;
  /** Whether an article is currently loading */
  isLoading: boolean;
  /** Fetch error, if any */
  error: string | null;
};

const WikiGuideContext = createContext<WikiGuideContextValue | null>(null);

export function WikiGuideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [article, setArticle] = useState<WikiGuideArticle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert search params to a plain object for matching
  const searchParamsObj = useMemo(() => {
    const obj: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }, [searchParams]);

  // Resolve the guide entry for the current pathname + search params
  const entry = useMemo(
    () => resolveGuideEntry(pathname, searchParamsObj),
    [pathname, searchParamsObj]
  );
  const isAvailable = entry !== null && entry.slugs.length > 0;

  // Close panel and reset when navigating to a page with no guide entry
  useEffect(() => {
    if (!isAvailable) {
      setIsOpen(false);
      setArticle(null);
      setActiveSlug(null);
      setError(null);
    }
  }, [isAvailable]);

  // Set default active slug when entry changes
  useEffect(() => {
    if (entry && entry.slugs.length > 0) {
      setActiveSlug(entry.slugs[0]);
      // Reset article when entry changes to force refetch
      setArticle(null);
    }
  }, [entry]);

  // Fetch article content when panel is opened or active slug changes
  useEffect(() => {
    if (!isOpen || !activeSlug) return;

    // Don't refetch if we already have this article
    if (article?.slug === activeSlug) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/wiki/article?slug=${encodeURIComponent(activeSlug)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Article not found"
              : "Failed to load article"
          );
        }
        return res.json();
      })
      .then((data: WikiGuideArticle) => {
        if (!cancelled) {
          setArticle(data);
          setIsLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeSlug, article?.slug]);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);

  const value = useMemo<WikiGuideContextValue>(
    () => ({
      isAvailable,
      entry,
      isOpen,
      toggle,
      close,
      open,
      activeSlug,
      setActiveSlug,
      article,
      isLoading,
      error,
    }),
    [isAvailable, entry, isOpen, toggle, close, open, activeSlug, article, isLoading, error]
  );

  return (
    <WikiGuideContext.Provider value={value}>
      {children}
    </WikiGuideContext.Provider>
  );
}

export function useWikiGuide(): WikiGuideContextValue {
  const context = useContext(WikiGuideContext);
  if (!context) {
    throw new Error("useWikiGuide must be used within a WikiGuideProvider");
  }
  return context;
}
