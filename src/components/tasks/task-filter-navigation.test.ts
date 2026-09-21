import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import {
  taskListParamsCleared,
  taskListParamsWith,
} from "@/lib/tasks/list-params";
import { useTaskFilterNavigation } from "./use-task-filter-navigation";

test("real hook composes rapid sibling edits, partial commits, Clear and history navigation", async () => {
  const target = new EventTarget();
  const fakeWindow = Object.assign(target, { location: { search: "" } });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const pushed: string[] = [];
  let controls: ReturnType<typeof useTaskFilterNavigation>;
  function Probe({ committed }: { committed: string }) {
    const navigation = useTaskFilterNavigation(committed, (destination) =>
      pushed.push(destination)
    );
    useLayoutEffect(() => {
      controls = navigation;
    });
    return createElement("output", null, navigation.query);
  }
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Probe, { committed: "view=all" }));
    });
    await act(async () => {
      controls.navigate((q) =>
        taskListParamsWith(q, "status", "blocked").toString()
      );
      controls.navigate((q) =>
        taskListParamsWith(q, "priority", "high").toString()
      );
    });
    assert.deepEqual(pushed, [
      "view=all&status=blocked",
      "view=all&status=blocked&priority=high",
    ]);
    await act(async () => {
      renderer!.update(createElement(Probe, { committed: pushed[0] }));
    });
    assert.equal(
      renderer!.root.findByType("output").children.join(""),
      pushed[1]
    );
    await act(async () => {
      renderer!.update(createElement(Probe, { committed: pushed[1] }));
    });
    await act(async () => {
      controls.navigate((q) => taskListParamsCleared(q).toString());
    });
    assert.equal(pushed[2], "view=all");
    // Popstate invalidates pending intent, including a URL previously submitted.
    fakeWindow.location.search = "?view=all&status=blocked";
    await act(async () => {
      fakeWindow.dispatchEvent(new Event("popstate"));
      renderer!.update(
        createElement(Probe, { committed: "view=all&status=blocked" })
      );
    });
    assert.equal(
      renderer!.root.findByType("output").children.join(""),
      "view=all&status=blocked"
    );
    fakeWindow.location.search = "?view=all&status=blocked&priority=high";
    await act(async () => {
      fakeWindow.dispatchEvent(new Event("popstate"));
      renderer!.update(
        createElement(Probe, {
          committed: "view=all&status=blocked&priority=high",
        })
      );
    });
    await act(async () => {
      controls.navigate((q) =>
        taskListParamsWith(q, "category", "general").toString()
      );
    });
    assert.equal(
      pushed.at(-1),
      "view=all&status=blocked&priority=high&category=general"
    );
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
