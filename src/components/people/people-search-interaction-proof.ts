import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

let query = "status=bogus&source=personal_referral";
const replacements: string[] = [];
mock.module("next/navigation", {
  namedExports: {
    useSearchParams: () => new URLSearchParams(query),
    useRouter: () => ({ replace: (url: string) => replacements.push(url) }),
  },
});

test("real search input preserves newer typing and cancels before a slow filter navigation", async (t) => {
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
  const { PeopleSearch } = await import("./people-search");
  const cancelSearchRef = { current: null as (() => void) | null };
  let mounted!: ReactTestRenderer;
  await act(() => {
    mounted = create(createElement(PeopleSearch, { cancelSearchRef }));
  });
  const input = () => mounted.root.findByType("input");
  await act(() => input().props.onChange({ target: { value: "Al" } }));
  await act(() => t.mock.timers.tick(300));
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0], "?search=Al&source=personal_referral");
  await act(() => input().props.onChange({ target: { value: "Alice" } }));
  query = replacements[0].slice(1);
  await act(() =>
    mounted.update(createElement(PeopleSearch, { cancelSearchRef }))
  );
  assert.equal(input().props.value, "Alice");
  await act(() => t.mock.timers.tick(300));
  assert.equal(replacements[1], "?search=Alice&source=personal_referral");
  query = replacements[1].slice(1);
  await act(() =>
    mounted.update(createElement(PeopleSearch, { cancelSearchRef }))
  );

  await act(() => input().props.onChange({ target: { value: "Bob" } }));
  assert.ok(cancelSearchRef.current);
  // The toolbar calls this before push. Leave query unchanged to model a slow response.
  await act(() => cancelSearchRef.current?.());
  assert.equal(
    input().props.value,
    "Alice",
    "same-URL navigation left an unsent draft visible"
  );
  await act(() => t.mock.timers.tick(1000));
  assert.equal(
    replacements.length,
    2,
    "pending search overrode the filter navigation"
  );
  query = "status=prospect";
  await act(() =>
    mounted.update(createElement(PeopleSearch, { cancelSearchRef }))
  );
  assert.equal(input().props.value, "");

  await act(() => input().props.onChange({ target: { value: "queued" } }));
  await act(() => events.dispatchEvent(new Event("popstate")));
  query = "search=Previous";
  await act(() =>
    mounted.update(createElement(PeopleSearch, { cancelSearchRef }))
  );
  await act(() => t.mock.timers.tick(1000));
  assert.equal(input().props.value, "Previous");
  assert.equal(
    replacements.length,
    2,
    "pending search overrode browser history"
  );
  await act(() => mounted.unmount());
  assert.equal(cancelSearchRef.current, null);
});
