"use client";

import { useEffect, useRef, useState } from "react";
import {
  reconcileTaskFilterNavigation,
  taskFilterNavigationQuery,
  type TaskFilterNavigation,
} from "./task-filter-navigation";

/** Pending sibling changes compose before Next commits the first navigation. */
export function useTaskFilterNavigation(
  committed: string,
  push: (destination: string) => void
) {
  const [draft, setDraft] = useState<TaskFilterNavigation>({
    committed,
    submitted: [],
  });
  const latestIntent = useRef<TaskFilterNavigation>({
    committed,
    submitted: [],
  });
  const reconciled = reconcileTaskFilterNavigation(draft, committed);
  if (reconciled !== draft) setDraft(reconciled);

  useEffect(() => {
    latestIntent.current = reconcileTaskFilterNavigation(
      latestIntent.current,
      committed
    );
  }, [committed]);

  useEffect(() => {
    const onPopState = () => {
      const next = {
        committed: window.location.search.slice(1),
        submitted: [],
      };
      latestIntent.current = next;
      setDraft(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (update: (query: string) => string) => {
    const current = reconcileTaskFilterNavigation(
      latestIntent.current,
      committed
    );
    const destination = update(taskFilterNavigationQuery(current));
    const next = { ...current, submitted: [...current.submitted, destination] };
    latestIntent.current = next;
    setDraft(next);
    push(destination);
  };
  return { query: taskFilterNavigationQuery(reconciled), navigate };
}
