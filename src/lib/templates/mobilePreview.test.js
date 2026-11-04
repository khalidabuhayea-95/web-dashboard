/**
 * A recorded preview video reaches the app until the editor records (or clears) another one.
 *
 * Previews are recorded by hand ("Generate preview"); a save never makes a new one. The mobile
 * mapper used to blank the video whenever the template's updatedAt passed previewUpdatedAt, so
 * pressing Save again in the editor — even with nothing changed — dropped the preview from the app.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplate, toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const PREVIEW_URL = "https://cdn.example.com/templates/previews/t1/preview.mp4";
const POSTER_URL = "https://cdn.example.com/templates/previews/t1/poster.webp";
const PREVIEW_RECORDED_AT = new Date("2026-11-01T08:14:54.240Z");

const savedAfterPreview = () => ({
  id: "t1",
  slug: "t1",
  name: "Template",
  status: "published",
  canvasSize: { width: 1080, height: 1920 },
  data: { pages: [{ id: "p1", width: 1080, height: 1920, elements: [] }] },
  previewStatus: "ready",
  previewVideoUrl: PREVIEW_URL,
  previewPosterUrl: POSTER_URL,
  previewDurationMs: 5000,
  previewVersion: 5,
  previewUpdatedAt: PREVIEW_RECORDED_AT,
  // Re-saved in the editor 16 s after the recording finished.
  updatedAt: new Date("2026-11-01T08:15:10.767Z"),
});

test("re-saving a template keeps its ready preview video in the app", () => {
  const template = toMobileTemplate(savedAfterPreview(), { includeProject: false });
  assert.equal(template.preview.status, "ready");
  assert.equal(template.previewVideoUrl, `${PREVIEW_URL}?v=${PREVIEW_RECORDED_AT.getTime()}`);
  assert.equal(template.preview.posterUrl, `${POSTER_URL}?v=${PREVIEW_RECORDED_AT.getTime()}`);
});

test("the slim detail keeps the preview after a re-save too", () => {
  const detail = toMobileTemplateDetailSlim(savedAfterPreview());
  const preview = detail.preview || detail.template?.preview;
  assert.equal(preview.status, "ready");
  assert.equal(preview.url, `${PREVIEW_URL}?v=${PREVIEW_RECORDED_AT.getTime()}`);
});
