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
        submitPeopleFile: async () => true,
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
    mounted.root.findByType("form").props.onSubmit({ preventDefault() {} })
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
