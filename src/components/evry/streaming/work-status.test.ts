import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { EvryAcknowledgementMeasurement } from "@/lib/evry/streaming/state";

import { EvryWorkStatus } from "./work-status";

type MockNode = Readonly<{
  id: string;
  focus(): void;
}>;

test("one stable pair of live regions preserves focus and records the committed acknowledgement", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  let activeElement: MockNode | null = null;
  const measurements: EvryAcknowledgementMeasurement[] = [];
  const performanceMeasures: Array<{
    name: string;
    options: PerformanceMeasureOptions;
  }> = [];
  t.mock.method(performance, "now", () => 180);
  t.mock.method(
    performance,
    "measure",
    (name: string, options?: PerformanceMeasureOptions) => {
      performanceMeasures.push({ name, options: options! });
      return {} as PerformanceMeasure;
    }
  );

  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(
      createElement("div", null, [
        createElement("button", { key: "button", id: "composer" }, "Send"),
        createElement(EvryWorkStatus, {
          key: "status",
          state: { phase: "idle" },
        }),
      ]),
      {
        createNodeMock(element) {
          const props = element.props as Record<string, unknown>;
          const id = String(props.id ?? props.role ?? "node");
          const node: MockNode = {
            id,
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
  const composer = mounted.root.findByProps({ id: "composer" }).instance;
  composer.focus();

  const polite = mounted.root.findByProps({ role: "status" });
  const assertive = mounted.root.findByProps({ role: "alert" });
  assert.equal(polite.props["aria-live"], "polite");
  assert.equal(assertive.props["aria-live"], "assertive");
  assert.equal(polite.props["aria-atomic"], "true");
  assert.equal(assertive.props["aria-atomic"], "true");
  const statusRoot = polite.parent?.parent;
  assert.equal(statusRoot?.props["aria-busy"], undefined);

  await act(() => {
    mounted.update(
      createElement("div", null, [
        createElement("button", { key: "button", id: "composer" }, "Send"),
        createElement(EvryWorkStatus, {
          key: "status",
          state: {
            phase: "reading",
            message: "Checking the people directory",
          },
          acknowledgement: {
            requestId: "10000000-0000-4000-8000-000000000001",
            submittedAt: 100,
          },
          activeRequestId: "10000000-0000-4000-8000-000000000001",
          onAcknowledgement: (measurement) => measurements.push(measurement),
        }),
      ])
    );
  });
  assert.equal(mounted.root.findByProps({ role: "status" }), polite);
  assert.equal(mounted.root.findByProps({ role: "alert" }), assertive);
  assert.equal(activeElement, composer);
  assert.equal(polite.parent?.parent?.props["data-busy"], true);
  assert.deepEqual(measurements, [{ durationMs: 80, withinBudget: true }]);
  assert.deepEqual(performanceMeasures, [
    {
      name: "evry.acknowledgement",
      options: {
        start: 100,
        end: 180,
        detail: { requestId: "10000000-0000-4000-8000-000000000001" },
      },
    },
  ]);

  await act(() => {
    mounted.update(
      createElement("div", null, [
        createElement("button", { key: "button", id: "composer" }, "Send"),
        createElement(EvryWorkStatus, {
          key: "status",
          state: {
            phase: "blocked",
            message: "This confirmation is no longer current.",
          },
          acknowledgement: {
            requestId: "10000000-0000-4000-8000-000000000001",
            submittedAt: 100,
          },
          activeRequestId: "10000000-0000-4000-8000-000000000001",
          onAcknowledgement: (measurement) => measurements.push(measurement),
        }),
      ])
    );
  });
  assert.equal(mounted.root.findByProps({ role: "status" }), polite);
  assert.equal(mounted.root.findByProps({ role: "alert" }), assertive);
  assert.equal(activeElement, composer);
  assert.deepEqual(measurements, [{ durationMs: 80, withinBudget: true }]);
  assert.equal(
    assertive.children.includes("This confirmation is no longer current."),
    true
  );
});

test("a stale acknowledgement cannot be measured during newer work", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const measurements: EvryAcknowledgementMeasurement[] = [];
  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(
      createElement(EvryWorkStatus, {
        state: { phase: "reading", message: "Opening newer work" },
        activeRequestId: "10000000-0000-4000-8000-000000000002",
        acknowledgement: {
          requestId: "10000000-0000-4000-8000-000000000001",
          submittedAt: 100,
        },
        onAcknowledgement: (measurement) => measurements.push(measurement),
      })
    );
  });
  assert.ok(renderer);
  assert.deepEqual(measurements, []);
});
