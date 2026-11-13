import assert from "node:assert/strict";
import { test } from "node:test";

import { decideDesignWrite, type ExistingDesign } from "./writeDecision";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const server = (contentHash: string, extra: Partial<ExistingDesign> = {}): ExistingDesign => ({
  contentHash,
  lastMutationId: "mutation-server",
  purged: false,
  ...extra,
});

test("a design the server has never held is created from a document write", () => {
  assert.deepEqual(
    decideDesignWrite(null, { mutationId: "m-1", hasData: true, contentHash: A, baseContentHash: null }),
    { kind: "create" },
  );
});

test("a header-only write about an unknown design has nothing to apply to", () => {
  assert.deepEqual(
    decideDesignWrite(null, { mutationId: "m-1", hasData: false, contentHash: "", baseContentHash: null }),
    { kind: "missing" },
  );
});

test("an edit that started from the server's document is a plain update", () => {
  assert.deepEqual(
    decideDesignWrite(server(A), { mutationId: "m-2", hasData: true, contentHash: B, baseContentHash: A }),
    { kind: "apply" },
  );
});

test("an edit that started from an OLDER document is a conflict — the device keeps both", () => {
  // Device 2 edited A into C while device 1 had already turned A into B on the server.
  assert.deepEqual(
    decideDesignWrite(server(B), { mutationId: "m-3", hasData: true, contentHash: C, baseContentHash: A }),
    { kind: "conflict" },
  );
});

test("a device that believes the design is new, when the server holds another document, conflicts", () => {
  assert.deepEqual(
    decideDesignWrite(server(B), { mutationId: "m-3", hasData: true, contentHash: C, baseContentHash: null }),
    { kind: "conflict" },
  );
});

test("writing the document the server already holds only applies the header", () => {
  // Two devices pushed the same bytes, or a retry whose mutation id a rename has since replaced.
  assert.deepEqual(
    decideDesignWrite(server(B), { mutationId: "m-4", hasData: true, contentHash: B, baseContentHash: A }),
    { kind: "applyHeaderOnly" },
  );
});

test("a header-only write never conflicts, however stale the device is", () => {
  // A rename on one device and an edit on another must not fork the design.
  assert.deepEqual(
    decideDesignWrite(server(C), { mutationId: "m-5", hasData: false, contentHash: "", baseContentHash: A }),
    { kind: "applyHeaderOnly" },
  );
});

test("a retry of the write the server already took answers the current state", () => {
  assert.deepEqual(
    decideDesignWrite(server(B, { lastMutationId: "m-6" }), {
      mutationId: "m-6",
      hasData: true,
      contentHash: B,
      baseContentHash: A,
    }),
    { kind: "replay" },
  );
});

test("nothing is written to a purged design", () => {
  for (const hasData of [true, false]) {
    assert.deepEqual(
      decideDesignWrite(server("", { purged: true }), {
        mutationId: "m-7",
        hasData,
        contentHash: hasData ? B : "",
        baseContentHash: A,
      }),
      { kind: "gone" },
    );
  }
});
