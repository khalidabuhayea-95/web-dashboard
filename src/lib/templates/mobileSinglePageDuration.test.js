/**
 * A one-page import never saved from the editor states its length under meta.import.page; the
 * app must get it (DAHNlJ_f8mI's 44.9 s of scenes opened as 15 s).
 *
 *   node --import tsx --test src/lib/templates/mobileSinglePageDuration.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const detail = (data) =>
  toMobileTemplateDetailSlim({ id: "tpl", name: "scenes", canvasWidth: 1080, canvasHeight: 1920, data }, {});

const text = { type: "textbox", text: "x", left: 0, top: 0, width: 100, height: 40, fontSize: 30, originX: "left", originY: "top", timelineStartMs: 0, timelineEndMs: 44861 };

test("the import's page length reaches the app", () => {
  const { project } = detail({ version: "7.0.0", objects: [text], meta: { import: { page: { durationMs: 44861 } } } });
  assert.equal(project.durationMs, 44861);
});

test("a saved timeline length wins over the import's", () => {
  const { project } = detail({ version: "7.0.0", objects: [text], timeline: { totalDurationMs: 20000 }, meta: { import: { page: { durationMs: 44861 } } } });
  assert.equal(project.durationMs, 20000);
});
