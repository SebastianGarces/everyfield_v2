import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { parsePeopleListQuery } from "@/lib/people/list-params";

let query = "status=bogus&source=personal_referral";
const replacements: string[] = [];
const pushes: string[] = [];
mock.module("next/navigation", {
  namedExports: {
    useSearchParams: () => new URLSearchParams(query),
    useRouter: () => ({
      replace: (url: string) => replacements.push(url),
      push: (url: string) => pushes.push(url),
    }),
  },
});
// Keep the production toolbar/filter handlers; only replace the portaled menu shell.
const group = ({ children }: { children: ReactNode }) =>
  createElement("div", null, children);
mock.module("@/components/ui/dropdown-menu", {
  namedExports: {
    DropdownMenu: group,
    DropdownMenuContent: group,
    DropdownMenuLabel: group,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: group,
    DropdownMenuCheckboxItem: ({
      children,
      onCheckedChange,
    }: {
      children: ReactNode;
      onCheckedChange: () => void;
    }) =>
      createElement(
        "button",
        { "data-option": true, onClick: onCheckedChange },
        children
      ),
  },
});

test("all toolbar controls compose pending destinations and acknowledge intermediate responses", async (t) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const events = new EventTarget();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: events,
  });
  t.after(() => {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    throw new Error(args.map(String).join(" "));
  });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { PeopleToolbar } = await import("./people-toolbar");
  const element = () =>
    createElement(PeopleToolbar, {
      view: parsePeopleListQuery(query).view,
      availableTags: [],
      total: 10,
    });
  let mounted!: ReactTestRenderer;
  await act(() => {
    mounted = create(element());
  });
  const input = () => mounted.root.findByType("input");
  const type = async (value: string) => {
    await act(() => input().props.onChange({ target: { value } }));
  };
  const tick = async () => {
    await act(() => t.mock.timers.tick(300));
  };
  const commit = async (destination: string) => {
    query = destination.replace(/^\?/, "");
    await act(() => mounted.update(element()));
  };
  const click = async (label: string, option = false) => {
    const button = mounted.root
      .findAllByType("button")
      .find(
        (node) =>
          node.children.includes(label) &&
          Boolean(node.props["data-option"]) === option
      );
    assert.ok(button, `Missing control ${label}`);
    await act(() => button.props.onClick());
  };

  await type("Al");
  await tick();
  assert.equal(replacements[0], "?search=Al&source=personal_referral");
  await type("Alice");
  await commit(replacements[0]);
  assert.equal(input().props.value, "Alice");
  await tick();
  assert.equal(replacements[1], "?search=Alice&source=personal_referral");
  await commit(replacements[1]);
  await type("Bob");
  await click("List");
  assert.equal(
    input().props.value,
    "Alice",
    "same-URL navigation kept unsent text"
  );
  await tick();
  assert.equal(replacements.length, 2);

  // Two rapid production filter handlers, followed by typing before either response.
  await commit("");
  await click("Prospect", true);
  const first = pushes.at(-1)!;
  assert.equal(first, "?status=prospect");
  await click("Personal Referral", true);
  const second = pushes.at(-1)!;
  assert.equal(second, "?status=prospect&source=personal_referral");
  await type("After");
  await commit(first);
  assert.equal(
    input().props.value,
    "After",
    "first acknowledgment erased newer typing"
  );
  await commit(second);
  assert.equal(
    input().props.value,
    "After",
    "second acknowledgment erased newer typing"
  );
  await tick();
  assert.equal(
    replacements[2],
    "?search=After&status=prospect&source=personal_referral"
  );
  await commit(replacements[2]);

  // Reverse the timing: search submits before either filter response commits.
  await click("Reset");
  await commit(pushes.at(-1)!);
  await click("Prospect", true);
  const third = pushes.at(-1)!;
  await click("Personal Referral", true);
  const fourth = pushes.at(-1)!;
  await type("Later");
  await tick();
  assert.equal(
    replacements[3],
    "?search=Later&status=prospect&source=personal_referral"
  );
  await commit(third);
  assert.equal(input().props.value, "Later");
  await commit(fourth);
  assert.equal(input().props.value, "Later");
  await commit(replacements[3]);

  // View and Reset must compose from the pending query too.
  await click("Pipeline");
  const pipeline = pushes.at(-1)!;
  assert.equal(
    pipeline,
    "?view=pipeline&search=Later&status=prospect&source=personal_referral"
  );
  await click("Reset");
  const reset = pushes.at(-1)!;
  assert.equal(reset, "?view=pipeline");
  await commit(pipeline);
  await commit(reset);
  await click("List");
  assert.equal(pushes.at(-1), "?");
  await commit(pushes.at(-1)!);
  assert.equal(input().props.value, "");

  // Reset then a filter, before Reset commits, cannot resurrect its old siblings.
  await click("Prospect", true);
  await commit(pushes.at(-1)!);
  await click("Reset");
  const clearing = pushes.at(-1)!;
  await click("Personal Referral", true);
  const afterReset = pushes.at(-1)!;
  assert.equal(afterReset, "?source=personal_referral");
  await commit(clearing);
  await commit(afterReset);

  await type("queued");
  await act(() => {
    events.dispatchEvent(new Event("popstate"));
  });
  await commit("search=Previous");
  await tick();
  assert.equal(input().props.value, "Previous");
  assert.equal(replacements.length, 4, "queued search overrode history");
  await act(() => mounted.unmount());
});
