import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { EvryPeopleFileWorkflowForm } from "./people-file-workflow";

type MockInput = {
  id: string;
  value: string;
  focus(): void;
};

test("a failed attachment stays selected and reports its error inside the form", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let renderer!: ReactTestRenderer;
  let submissions = 0;
  await act(() => {
    renderer = create(
      createElement(EvryPeopleFileWorkflowForm, {
        personId: null,
        isComposerBlocked: false,
        isSending: false,
        submitPeopleFile: async () => {
          submissions++;
          return {
            status: "failed" as const,
            message:
              submissions > 1
                ? "Choose a file that is 10 MB or smaller."
                : undefined,
          };
        },
      })
    );
  });
  const file = new File(["name\nAlex"], "people.csv", { type: "text/csv" });
  await act(() =>
    renderer.root
      .findByProps({ type: "file" })
      .props.onChange({ target: { files: [file] } })
  );
  let stopped = false;
  const submit = () =>
    renderer.root.findByType("form").props.onSubmit({
      preventDefault() {},
      stopPropagation() {
        stopped = true;
      },
    });
  await act(submit);
  assert.equal(
    stopped,
    true,
    "a portal form must not bubble submission to the chat composer"
  );
  assert.equal(submissions, 1);
  assert.match(
    renderer.root.findByProps({ role: "alert" }).children.join(""),
    /could not be prepared/
  );
  assert.equal(
    renderer.root.findByProps({ type: "submit" }).props.disabled,
    false
  );
  await act(submit);
  assert.equal(submissions, 2, "the selected file is available to retry");
  assert.equal(
    renderer.root.findByProps({ role: "alert" }).children.join(""),
    "Choose a file that is 10 MB or smaller."
  );
  await act(() => renderer.unmount());
});

test("clearing a file preserves its node and focus while resetting the native value", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let activeElement: MockInput | null = null;
  let renderer: ReactTestRenderer | null = null;
  const nodes = new Map<string, MockInput>();
  await act(() => {
    renderer = create(
      createElement(EvryPeopleFileWorkflowForm, {
        personId: null,
        isComposerBlocked: false,
        isSending: false,
        submitPeopleFile: async () => ({ status: "submitted" as const }),
      }),
      {
        createNodeMock(element) {
          const id = String((element.props as { id?: string }).id ?? "node");
          const existing = nodes.get(id);
          if (existing) return existing;
          const node: MockInput = {
            id,
            value: "",
            focus() {
              activeElement = node;
            },
          };
          nodes.set(id, node);
          return node;
        },
      }
    );
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  const fileInput = mounted.root.findAllByType("input")[0]!;
  const fileNode = fileInput.instance as MockInput;
  fileNode.focus();
  const selectedFile = {
    name: "people.csv",
    type: "text/csv",
    size: 8,
    arrayBuffer: async () => new ArrayBuffer(8),
  };
  fileNode.value = "C:\\fakepath\\people.csv";

  await act(() => {
    fileInput.props.onChange({
      target: { files: [selectedFile] },
    });
  });

  const selectedInput = mounted.root.findAllByType("input")[0]!;
  assert.equal(selectedInput, fileInput);
  assert.equal(activeElement, fileNode);
  assert.equal(
    mounted.root.findByProps({ type: "submit" }).props.disabled,
    false
  );

  await act(() =>
    mounted.root
      .findByType("form")
      .props.onSubmit({ preventDefault() {}, stopPropagation() {} })
  );
  assert.equal(mounted.root.findAllByType("input")[0], fileInput);
  assert.equal(activeElement, fileNode);
  assert.equal(fileNode.value, "");
  assert.equal(
    mounted.root.findByProps({ type: "submit" }).props.disabled,
    true
  );

  fileNode.value = "C:\\fakepath\\people.csv";
  await act(() => {
    fileInput.props.onChange({ target: { files: [selectedFile] } });
  });
  assert.equal(
    mounted.root.findByProps({ type: "submit" }).props.disabled,
    false
  );

  await act(() => {
    mounted.root.findAllByType("select")[0]!.props.onChange({
      target: { value: "person_photo" },
    });
  });
  assert.equal(mounted.root.findAllByType("input")[0], fileInput);
  assert.equal(activeElement, fileNode);
  assert.equal(fileNode.value, "");
  assert.equal(
    mounted.root.findByProps({ type: "submit" }).props.disabled,
    true
  );
});

test("CSV duplicate decisions are collected independently for each row", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const submissions: unknown[] = [];
  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(
      createElement(EvryPeopleFileWorkflowForm, {
        personId: null,
        isComposerBlocked: false,
        isSending: false,
        submitPeopleFile: async (input: unknown) => {
          submissions.push(input);
          return submissions.length === 1
            ? {
                status: "needs_duplicate_resolution" as const,
                prepared: {
                  reference: "signed-reference",
                  digest: "a".repeat(64),
                  duplicateRows: [
                    {
                      rowNumber: 2,
                      label: "Row 2: Ada Lovelace",
                      mergeTarget: "Ada Existing",
                    },
                    {
                      rowNumber: 8,
                      label: "Row 8: Grace Hopper",
                      mergeTarget: "Grace Existing",
                    },
                  ],
                },
              }
            : { status: "submitted" as const };
        },
      })
    );
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  const fileInput = mounted.root.findByProps({ type: "file" });
  const selectedFile = {
    name: "people.csv",
    type: "text/csv",
    size: 8,
    lastModified: 123,
  };
  await act(() =>
    fileInput.props.onChange({ target: { files: [selectedFile] } })
  );
  await act(() =>
    mounted.root
      .findByType("form")
      .props.onSubmit({ preventDefault() {}, stopPropagation() {} })
  );

  const resolutionSelects = mounted.root
    .findAllByType("select")
    .filter((select) => String(select.props.id).includes("duplicate-"));
  assert.equal(resolutionSelects.length, 2);
  await act(() => {
    resolutionSelects[0]!.props.onChange({ target: { value: "merge" } });
    resolutionSelects[1]!.props.onChange({ target: { value: "skip" } });
  });
  await act(() =>
    mounted.root
      .findByType("form")
      .props.onSubmit({ preventDefault() {}, stopPropagation() {} })
  );

  assert.deepEqual(
    (submissions[1] as { duplicateResolutions: unknown }).duplicateResolutions,
    { "2": "merge", "8": "skip" }
  );
});

test("commitment files reject WebP specifically and submit optional notes", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let submitted: unknown = null;
  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(
      createElement(EvryPeopleFileWorkflowForm, {
        personId: "10000000-0000-4000-8000-000000000001",
        isComposerBlocked: false,
        isSending: false,
        submitPeopleFile: async (input: unknown) => {
          submitted = input;
          return { status: "submitted" as const };
        },
      })
    );
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  await act(() => {
    mounted.root.findAllByType("select")[0]!.props.onChange({
      target: { value: "commitment_document" },
    });
  });
  const fileInput = mounted.root.findByProps({ type: "file" });
  await act(() =>
    fileInput.props.onChange({
      target: {
        files: [{ name: "commitment.webp", type: "image/webp", size: 4 }],
      },
    })
  );
  assert.match(
    mounted.root.findByProps({ role: "alert" }).children.join(""),
    /PDF, JPEG, or PNG/
  );

  await act(() =>
    fileInput.props.onChange({
      target: {
        files: [{ name: "commitment.png", type: "image/png", size: 4 }],
      },
    })
  );
  const inputs = mounted.root.findAllByType("input");
  await act(() => {
    inputs
      .find((input) => input.props.type === "date")!
      .props.onChange({
        target: { value: "2026-08-29" },
      });
    mounted.root.findByType("textarea").props.onChange({
      target: { value: "Signed after the team conversation." },
    });
  });
  await act(() =>
    mounted.root
      .findByType("form")
      .props.onSubmit({ preventDefault() {}, stopPropagation() {} })
  );
  assert.equal(
    (submitted as { notes: string }).notes,
    "Signed after the team conversation."
  );
});
