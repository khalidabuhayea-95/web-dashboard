/**
 * How long a page runs when it holds video.
 *
 *   node --import tsx --test src/lib/editor/pageDuration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PAGE_DURATION_MS, getPageDurationMs } from "@/lib/editor/animationTimeline";

const clip = (seconds: number) => ({ type: "video", videoStart: 0, videoEnd: seconds, videoDuration: seconds });

test("a page authored longer than its clip keeps its length (the clip loops)", () => {
  // DAHNlJ_f8mI: six scenes over one 15 s backdrop clip.
  assert.equal(getPageDurationMs({ durationMs: 44861, elements: [clip(15)] } as never), 44861);
});

test("a page shorter than its clip, or at the default length, runs for the clip", () => {
  assert.equal(getPageDurationMs({ durationMs: 5000, elements: [clip(15)] } as never), 15000);
  assert.equal(getPageDurationMs({ durationMs: DEFAULT_PAGE_DURATION_MS, elements: [clip(10)] } as never), 10000);
  assert.equal(getPageDurationMs({ durationMs: null, elements: [clip(10)] } as never), 10000);
});

test("a trimmed clip counts by what it plays", () => {
  assert.equal(getPageDurationMs({ durationMs: 5000, elements: [{ type: "video", videoStart: 2, videoEnd: 8 }] } as never), 6000);
});

test("without video the authored length stands, defaulting when absent", () => {
  assert.equal(getPageDurationMs({ durationMs: 7000, elements: [] } as never), 7000);
  assert.equal(getPageDurationMs({ durationMs: null, elements: [] } as never), DEFAULT_PAGE_DURATION_MS);
});
