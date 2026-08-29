import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { EvryPeopleFileWorkflowForm } from "./people-file-workflow";

type MockInput = Readonly<{
  id: string;
  focus(): void;
}>;

test("selecting a file preserves the focused file-input node", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let activeElement: MockInput | null = null;
  let renderer: ReactTestRenderer | null = null;
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
          const node: MockInput = {
            id: String((element.props as { id?: string }).id ?? "node"),
            focus() {
              activeElement = node;
            },
          };
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

  await act(() => {
    fileInput.props.onChange({
      target: {
        files: [
          {
            name: "people.csv",
            type: "text/csv",
            size: 8,
            arrayBuffer: async () => new ArrayBuffer(8),
          },
        ],
      },
    });
  });

  const selectedInput = mounted.root.findAllByType("input")[0]!;
  assert.equal(selectedInput, fileInput);
  assert.equal(activeElement, fileNode);
  assert.equal(
    mounted.root.findByProps({ type: "submit" }).props.disabled,
    false
  );
});
