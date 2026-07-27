"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { TocHeading } from "@/lib/wiki/toc";

/**
 * Hands the current article's headings from the article page to the wiki
 * sidebar (prototype B renders the TOC under the active sidebar item, and the
 * sidebar lives in the layout, above the page in the tree).
 *
 * The page publishes; the sidebar subscribes. Only ever holds the article the
 * reader is on — `PublishToc` clears the store on unmount, so a section index
 * or a non-wiki page leaves the sidebar TOC empty.
 */

type TocEntry = {
  /** The article the headings belong to, as a wiki href (`/wiki/...`). */
  href: string;
  headings: TocHeading[];
};

type TocStore = {
  entry: TocEntry | null;
  setEntry: (entry: TocEntry | null) => void;
};

const TocContext = createContext<TocStore | null>(null);

export function TocProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<TocEntry | null>(null);

  return (
    <TocContext.Provider value={{ entry, setEntry }}>
      {children}
    </TocContext.Provider>
  );
}

/** Rendered by the article page: publishes its TOC while mounted. */
export function PublishToc({ href, headings }: TocEntry) {
  const store = useContext(TocContext);
  const setEntry = store?.setEntry;

  useEffect(() => {
    if (!setEntry) return;
    setEntry({ href, headings });
    return () => setEntry(null);
  }, [setEntry, href, headings]);

  return null;
}

/** The active article's headings, or null when no article is publishing. */
export function useSidebarToc(): TocEntry | null {
  return useContext(TocContext)?.entry ?? null;
}
