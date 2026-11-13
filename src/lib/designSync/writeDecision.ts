// What the server does with one design write. Pure, so every branch is pinned by a test.
//
// The rule the product chose: NEVER lose work, and never rely on a device's clock.
//  - A document write says which CONTENT it was based on (`baseContentHash`: the hash of the
//    document the device last synced). If the server's content is something else — another device
//    got there first — it is a conflict, and the device keeps both (its own becomes a copy).
//  - Header fields — name, Trash, folder — are last-writer-wins by arrival. They do not take part
//    in conflict detection at all: a rename on one device, or the server unfiling a design
//    because its folder was deleted, must never fork a design whose content nobody else touched.
//    (That is why the test is on content hashes and not on `revision`, which every header change
//    bumps too.)
//  - A retry of the write the server already took (its answer was lost on the way back) is
//    answered with the current state, never a conflict.

export type ExistingDesign = {
  contentHash: string;
  lastMutationId: string | null;
  purged: boolean;
};

export type DesignWrite = {
  mutationId: string;
  /** False for a header-only write (rename, Trash, restore, folder). */
  hasData: boolean;
  /** Hash of the document being written; "" for a header-only write. */
  contentHash: string;
  /** Hash of the document this edit started from; null for a design the device believes is new. */
  baseContentHash: string | null;
};

export type WriteDecision =
  | { kind: "create" }
  | { kind: "replay" }
  | { kind: "apply" }
  | { kind: "applyHeaderOnly" }
  | { kind: "conflict" }
  | { kind: "gone" }
  | { kind: "missing" };

export function decideDesignWrite(existing: ExistingDesign | null, write: DesignWrite): WriteDecision {
  if (!existing) {
    // A header-only write about a design the server has never held has nothing to apply to.
    return write.hasData ? { kind: "create" } : { kind: "missing" };
  }
  if (existing.purged) return { kind: "gone" };
  if (existing.lastMutationId && existing.lastMutationId === write.mutationId) {
    return { kind: "replay" };
  }
  if (!write.hasData) return { kind: "applyHeaderOnly" };
  // The server already holds exactly this document (two devices pushed the same bytes, or this
  // is a retry whose mutation id was since overwritten by a header change).
  if (write.contentHash === existing.contentHash) return { kind: "applyHeaderOnly" };
  // The edit started from what the server holds: a plain update.
  if (write.baseContentHash && write.baseContentHash === existing.contentHash) return { kind: "apply" };
  return { kind: "conflict" };
}
