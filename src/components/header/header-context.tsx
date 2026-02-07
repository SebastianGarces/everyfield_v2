"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type HeaderBreadcrumbItem = {
  label: string;
  href?: string;
};

type HeaderContextValue = {
  breadcrumbs: HeaderBreadcrumbItem[];
  setBreadcrumbs: (items: HeaderBreadcrumbItem[]) => void;
  actionsContainer: HTMLDivElement | null;
  setActionsContainer: (el: HTMLDivElement | null) => void;
};

const HeaderContext = createContext<HeaderContextValue | null>(null);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbsState] = useState<HeaderBreadcrumbItem[]>(
    []
  );
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null);

  const setBreadcrumbs = useCallback((items: HeaderBreadcrumbItem[]) => {
    setBreadcrumbsState(items);
  }, []);

  return (
    <HeaderContext.Provider
      value={{ breadcrumbs, setBreadcrumbs, actionsContainer, setActionsContainer }}
    >
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  const ctx = useContext(HeaderContext);
  if (!ctx) {
    throw new Error("useHeader must be used within a HeaderProvider");
  }
  return ctx;
}
