import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useFieldSave, type SaveOutcome } from "./field-save";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function field() {
  let draft = "Austin";
  let stored = "Austin";
  let hook: ReturnType<typeof useFieldSave> | undefined;
  const requests: {
    value: string;
    resolve: (outcome: SaveOutcome) => void;
    reject: (error: Error) => void;
  }[] = [];
  function Field() {
    const current = useFieldSave({
      typed: () => draft,
      stored,
      reset: (value) => {
        draft = value;
      },
      save: (value) =>
        new Promise((resolve, reject) =>
          requests.push({ value, resolve, reject })
        ),
    });
    useEffect(() => {
      hook = current;
    });
    return createElement("div", current.editProps);
  }
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Field));
  });
  const current = () => {
    assert.ok(hook);
    return hook;
  };
  return {
    current,
    requests,
    refresh: async (value: string) => {
      await act(async () => {
        stored = value;
        renderer.update(createElement(Field));
      });
    },
    reject: async (index: number) => {
      await act(async () => {
        requests[index].reject(new Error("offline"));
      });
    },
    draft: () => draft,
    type: async (value: string) => {
      await act(async () => {
        draft = value;
        current().editProps.onInput();
      });
    },
    commit: async () => {
      await act(async () => {
        current().commit();
      });
    },
    revert: async () => {
      await act(async () => {
        current().revert();
      });
    },
    answer: async (index: number, outcome: SaveOutcome) => {
      await act(async () => {
        requests[index].resolve(outcome);
      });
    },
    close: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

test("unsaved input is marked, and explicit revert restores it without a write", async () => {
  const f = await field();
  try {
    assert.equal(f.current().editProps["data-uncommitted"], undefined);
    await f.type("Boston");
    assert.equal(f.current().editProps["data-uncommitted"], "true");
    await f.revert();
    assert.equal(f.draft(), "Austin");
    assert.equal(f.current().editProps["data-uncommitted"], undefined);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

test("pending saves stay marked and cannot be reverted; success releases the field", async () => {
  const f = await field();
  try {
    await f.type("Boston");
    await f.commit();
    await f.revert();
    assert.equal(f.draft(), "Boston");
    assert.equal(f.current().editProps["data-uncommitted"], "true");
    await f.answer(0, { success: true });
    assert.equal(f.current().editProps["data-uncommitted"], undefined);
    assert.equal(f.current().state.status, "saved");
  } finally {
    await f.close();
  }
});

test("refusal retains the draft for retry or explicit revert", async () => {
  const f = await field();
  try {
    await f.type("");
    await f.commit();
    await f.answer(0, {
      success: false,
      error: "Name is required",
      invalid: ["name"],
    });
    assert.equal(f.draft(), "");
    assert.equal(f.current().editProps["data-uncommitted"], "true");
    assert.deepEqual(f.current().state, {
      status: "failed",
      message: "Name is required",
      invalid: ["name"],
    });
    await f.commit();
    assert.equal(f.requests.length, 2);
    await f.answer(1, { success: false, error: "Name is required" });
    await f.revert();
    assert.equal(f.draft(), "Austin");
    assert.equal(f.current().editProps["data-uncommitted"], undefined);
  } finally {
    await f.close();
  }
});

test("queued commits snapshot their values and an older result cannot release a newer save", async () => {
  const f = await field();
  try {
    await f.type("Boston");
    await f.commit();
    await f.type("Chicago");
    await f.commit();
    await f.type("Denver");
    assert.deepEqual(
      f.requests.map((r) => r.value),
      ["Boston"]
    );
    await f.answer(0, { success: true });
    assert.deepEqual(
      f.requests.map((r) => r.value),
      ["Boston", "Chicago"]
    );
    assert.equal(f.current().state.status, "saving");
    assert.equal(f.current().editProps["data-uncommitted"], "true");
    await f.answer(1, { success: true });
    assert.equal(f.draft(), "Denver");
    assert.equal(f.current().editProps["data-uncommitted"], "true");
    await f.revert();
    assert.equal(f.draft(), "Chicago");
    assert.equal(f.current().editProps["data-uncommitted"], undefined);
  } finally {
    await f.close();
  }
});

for (const rejection of [false, true]) {
  test(`a queued ${rejection ? "network failure" : "refusal"} keeps a draft that differs from the earlier saved value`, async () => {
    const f = await field();
    try {
      await f.type("Boston");
      await f.commit();
      await f.type("Chicago");
      await f.commit();
      await f.answer(0, { success: true });
      await f.refresh("Boston");
      await f.type("Austin");
      if (rejection) await f.reject(1);
      else await f.answer(1, { success: false, error: "Refused" });
      assert.equal(f.current().editProps["data-uncommitted"], "true");
      assert.equal(f.draft(), "Austin");
      await f.revert();
      assert.equal(f.draft(), "Boston");
    } finally {
      await f.close();
    }
  });
}

test("revert uses an earlier acknowledgement while its refreshed prop is delayed", async () => {
  const f = await field();
  try {
    await f.type("Boston");
    await f.commit();
    await f.type("Chicago");
    await f.commit();
    await f.answer(0, { success: true });
    await f.answer(1, { success: false, error: "Refused" });
    await f.revert();
    assert.equal(f.draft(), "Boston");
    await f.refresh("Denver");
    await f.type("Chicago");
    await f.revert();
    assert.equal(f.draft(), "Denver");
  } finally {
    await f.close();
  }
});

for (const refreshEarlier of [false, true]) {
  test(`revert preserves the latest queued success with ${refreshEarlier ? "intermediate" : "delayed"} props`, async () => {
    const f = await field();
    try {
      await f.type("Boston");
      await f.commit();
      await f.type("Chicago");
      await f.commit();
      await f.answer(0, { success: true });
      if (refreshEarlier) await f.refresh("Boston");
      await f.answer(1, { success: true });
      await f.type("Denver");
      await f.revert();
      assert.equal(f.draft(), "Chicago");
      assert.equal(f.current().editProps["data-uncommitted"], undefined);
      await f.refresh("Chicago");
      await f.type("Denver");
      await f.revert();
      assert.equal(f.draft(), "Chicago");
      await f.refresh("Portland");
      await f.type("Denver");
      await f.revert();
      assert.equal(f.draft(), "Portland");
    } finally {
      await f.close();
    }
  });
}
