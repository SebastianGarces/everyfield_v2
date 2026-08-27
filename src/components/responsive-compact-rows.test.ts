import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Children,
  createRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { DocumentLibraryFilters } from "./documents/documents-library";
import {
  resetQuickAddForm,
  submitQuickAddTask,
  TaskQuickAddForm,
} from "./tasks/task-quick-add";

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function childElements(children: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((element) => element as ReactElement<ElementProps>);
}

test("document filters keep Search and all three state callbacks in order", () => {
  const changes: string[] = [];
  const filters = DocumentLibraryFilters({
    search: "",
    onSearchChange: (value) => changes.push(`search:${value}`),
    category: "all",
    onCategoryChange: (value) => changes.push(`category:${value}`),
    phase: "all",
    onPhaseChange: (value) => changes.push(`phase:${value}`),
    format: "all",
    onFormatChange: (value) => changes.push(`format:${value}`),
    categories: ["commitment"],
    phases: [1],
    formats: ["pdf"],
  }) as ReactElement<ElementProps>;

  const [searchGroup, filtersGroup] = childElements(filters.props.children);
  const [, search] = childElements(searchGroup.props.children);
  const filterControls = childElements(filtersGroup.props.children);

  assert.equal(
    filtersGroup.props.className,
    "flex flex-wrap gap-2",
    "fixed-width filters must wrap inside their containing card"
  );
  assert.equal(search.props.placeholder, "Search templates...");
  assert.deepEqual(
    filterControls.map((control) => control.props.ariaLabel),
    [
      "Filter templates by category",
      "Filter templates by phase",
      "Filter templates by file format",
    ],
    "Search must be followed by category, phase, then format"
  );

  (search.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "launch" },
  });
  for (const [control, value] of [
    [filterControls[0], "commitment"],
    [filterControls[1], "1"],
    [filterControls[2], "pdf"],
  ] as const) {
    (control.props.onValueChange as (next: string) => void)(value);
  }

  assert.deepEqual(changes, [
    "search:launch",
    "category:commitment",
    "phase:1",
    "format:pdf",
  ]);
});

test("quick add retains its fields, native date, and action handlers in responsive rows", () => {
  let submitted: FormData | undefined;
  let cancelCount = 0;
  const form = TaskQuickAddForm({
    formRef: createRef<HTMLFormElement>(),
    titleRef: createRef<HTMLInputElement>(),
    isPending: false,
    onSubmit: (formData) => {
      submitted = formData;
    },
    onCancel: () => {
      cancelCount += 1;
    },
  }) as ReactElement<ElementProps>;
  const [title, details, actions] = childElements(form.props.children);
  const [dueDate, priority] = childElements(details.props.children);
  const [priorityTrigger] = childElements(priority.props.children);
  const [add, cancel] = childElements(actions.props.children);
  const formData = new FormData();

  assert.equal(
    form.props.className,
    "bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3"
  );
  assert.equal(title.props.name, "title");
  assert.equal(title.props["aria-label"], "Task title");
  assert.equal(title.props.required, true);
  assert.equal(title.props.autoFocus, true);
  assert.equal(
    title.props.className,
    "h-8 w-full text-sm sm:w-auto sm:flex-1",
    "the title must take the complete compact row"
  );
  assert.equal(dueDate.props.name, "dueDate");
  assert.equal(dueDate.props.type, "date");
  assert.equal(dueDate.props["aria-label"], "Due date");
  assert.equal(priority.props.name, "priority");
  assert.equal(priority.props.defaultValue, "medium");
  assert.equal(priorityTrigger.props["aria-label"], "Priority");
  assert.equal(add.props.type, "submit");
  assert.equal(cancel.props.type, "button");

  (form.props.action as (data: FormData) => void)(formData);
  (cancel.props.onClick as () => void)();

  assert.equal(submitted, formData, "the form action retains its submit path");
  assert.equal(cancelCount, 1, "Cancel retains its close handler");
});

test("quick add preserves its pending disabled controls", () => {
  const form = TaskQuickAddForm({
    formRef: createRef<HTMLFormElement>(),
    titleRef: createRef<HTMLInputElement>(),
    isPending: true,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  }) as ReactElement<ElementProps>;
  const [title, details, actions] = childElements(form.props.children);
  const [dueDate, priority] = childElements(details.props.children);
  const [add, cancel] = childElements(actions.props.children);

  assert.equal(title.props.disabled, true);
  assert.equal(dueDate.props.disabled, true);
  assert.equal(priority.props.disabled, undefined);
  assert.equal(add.props.disabled, true);
  assert.equal(cancel.props.disabled, true);
});

test("quick add submits the server action and handles success or errors", async () => {
  const formData = new FormData();
  let submitted: FormData | undefined;
  let successCount = 0;
  let receivedError: string | undefined;

  await submitQuickAddTask(
    formData,
    async (submittedFormData) => {
      submitted = submittedFormData;
      return { success: true };
    },
    {
      onSuccess: () => {
        successCount += 1;
      },
      onError: (error) => {
        receivedError = error;
      },
    }
  );

  assert.equal(submitted, formData);
  assert.equal(successCount, 1);
  assert.equal(receivedError, undefined);

  await submitQuickAddTask(
    formData,
    async () => ({ success: false, error: "Unable to create task" }),
    {
      onSuccess: () => {
        successCount += 1;
      },
      onError: (error) => {
        receivedError = error;
      },
    }
  );

  assert.equal(successCount, 1);
  assert.equal(receivedError, "Unable to create task");
});

test("quick add resets the form and refocuses the title after success", () => {
  let resetCount = 0;
  let focusCount = 0;

  resetQuickAddForm(
    { reset: () => (resetCount += 1) } as unknown as HTMLFormElement,
    { focus: () => (focusCount += 1) } as unknown as HTMLInputElement
  );

  assert.equal(resetCount, 1);
  assert.equal(focusCount, 1);
});
