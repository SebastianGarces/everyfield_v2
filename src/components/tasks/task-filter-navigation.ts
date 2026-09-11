export interface TaskFilterNavigation {
  committed: string;
  submitted: string[];
}

export function reconcileTaskFilterNavigation(
  current: TaskFilterNavigation,
  committed: string
): TaskFilterNavigation {
  if (current.committed === committed) return current;
  const index = current.submitted.indexOf(committed);
  return {
    committed,
    submitted: index < 0 ? [] : current.submitted.slice(index + 1),
  };
}

export function taskFilterNavigationQuery(current: TaskFilterNavigation) {
  return current.submitted.at(-1) ?? current.committed;
}
