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
import {
  resolveGuideEntry,
  type WikiGuideEntry,
} from "@/lib/wiki/guide-config";

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
  const [openEntryKey, setOpenEntryKey] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [article, setArticle] = useState<WikiGuideArticle | null>(null);
  const [errorState, setErrorState] = useState<{
    slug: string;
    message: string;
  } | null>(null);

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
  const entryKey = useMemo(
    () =>
      entry ? `${pathname}::${entry.label}::${entry.slugs.join("|")}` : null,
    [entry, pathname]
  );
  const activeSlug =
    entry && entry.slugs.length > 0
      ? selectedSlug && entry.slugs.includes(selectedSlug)
        ? selectedSlug
        : entry.slugs[0]
      : null;
  const resolvedArticle = article?.slug === activeSlug ? article : null;
  const error = errorState?.slug === activeSlug ? errorState.message : null;
  const isOpen = !!entryKey && openEntryKey === entryKey;
  const isLoading = isOpen && !!activeSlug && !resolvedArticle && !error;

  // Fetch article content when panel is opened or active slug changes
  useEffect(() => {
    if (!isOpen || !activeSlug) return;

    // Don't refetch if we already have this article
    if (resolvedArticle || error) return;

    let cancelled = false;

    fetch(`/api/wiki/article?slug=${encodeURIComponent(activeSlug)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404 ? "Article not found" : "Failed to load article"
          );
        }
        return res.json();
      })
      .then((data: WikiGuideArticle) => {
        if (!cancelled) {
          setArticle(data);
          setErrorState(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setErrorState({ slug: activeSlug, message: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeSlug, resolvedArticle, error]);

  const toggle = useCallback(() => {
    if (!entryKey) return;

    if (openEntryKey === entryKey) {
      setOpenEntryKey(null);
      return;
    }

    if (errorState?.slug === activeSlug) {
      setErrorState(null);
    }
    setOpenEntryKey(entryKey);
  }, [entryKey, openEntryKey, errorState, activeSlug]);
  const close = useCallback(() => setOpenEntryKey(null), []);
  const open = useCallback(() => {
    if (!entryKey) return;

    if (errorState?.slug === activeSlug) {
      setErrorState(null);
    }
    setOpenEntryKey(entryKey);
  }, [entryKey, errorState, activeSlug]);
  const setActiveSlug = useCallback(
    (slug: string) => {
      if (errorState?.slug === slug) {
        setErrorState(null);
      }
      setSelectedSlug(slug);
    },
    [errorState]
  );

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
      article: resolvedArticle,
      isLoading,
      error,
    }),
    [
      isAvailable,
      entry,
      isOpen,
      toggle,
      close,
      open,
      activeSlug,
      setActiveSlug,
      resolvedArticle,
      isLoading,
      error,
    ]
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
