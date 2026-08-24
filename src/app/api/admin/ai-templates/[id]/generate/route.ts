import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import {
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import {
  handleApiError,
  handleBadRequest,
  handleForbidden,
  handleNotFound,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { publishCardThumb } from "@/lib/aiTools/thumb.server";
import { aiTemplateModelIncompatibility } from "@/lib/aiTemplates/models";
import { runAiTemplateRender } from "@/lib/aiTemplates/replicate.server";

export const runtime = "nodejs";
// The model itself can take minutes on a cold start; match the media routes.
export const maxDuration = 300;

const BUCKET = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Runs the template's own prompt + model to produce its card art. The before
// image comes from a direct upload or a gallery pick (templates snapshot the
// bytes, they never link to gallery rows); templates with input kind "none"
// generate from the prompt alone. Both card images update in one step, so the
// pair can never show a before that did not produce the after.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can generate AI template art");
    }

    const { id } = await params;
    const template = await prisma.aiTemplate.findUnique({ where: { id } });
    if (!template) return handleNotFound("AI template");

    const incompatibility = aiTemplateModelIncompatibility(template.model, template.referenceKind);
    if (incompatibility) return handleBadRequest(incompatibility);

    const formData = await request.formData().catch(() => null);
    if (!formData) return handleBadRequest("Invalid multipart form data");

    const generateOnly = template.referenceKind === "none";
    let inputBuffer: Buffer | null = null;

    if (!generateOnly) {
      const fileEntry = formData.get("file");
      const galleryImageId = String(formData.get("galleryImageId") || "").trim();

      if (fileEntry instanceof File) {
        const mimeType = String(fileEntry.type || "").toLowerCase();
        const size = Number(fileEntry.size || 0);
        if (!mimeType.startsWith("image/")) return handleBadRequest("Only image files are allowed.");
        if (mimeType.includes("svg")) return handleBadRequest("SVG uploads are not allowed.");
        if (size <= 0) return handleBadRequest("The selected file is empty.");
        if (size > MAX_IMAGE_BYTES) return handleBadRequest("Image is too large (max 20 MB).");
        inputBuffer = Buffer.from(await fileEntry.arrayBuffer());
      } else if (galleryImageId) {
        const galleryImage = await prisma.galleryImage.findUnique({
          where: { id: galleryImageId },
        });
        if (!galleryImage) return handleBadRequest("That gallery image no longer exists");
        const imageResponse = await fetch(galleryImage.url);
        if (!imageResponse.ok) {
          return handleBadRequest("The gallery image could not be downloaded.");
        }
        inputBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else {
        return handleBadRequest(
          `This template expects a ${template.referenceKind} photo — upload one or pick it from the gallery.`
        );
      }
    }

    // Normalise the input like the batch renderer does: EXIF-rotated, 1024px,
    // JPEG — keeps provider payloads small and befores consistent.
    let normalizedInput: Buffer | null = null;
    if (inputBuffer) {
      try {
        normalizedInput = await sharp(inputBuffer)
          .rotate()
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch (_error) {
        return handleBadRequest("That file could not be read as an image.");
      }
    }

    const rendered = await runAiTemplateRender({
      modelId: template.model,
      prompt: template.prompt,
      imageBuffer: normalizedInput,
      imageMime: "image/jpeg",
    });

    const afterBody = await sharp(rendered.buffer)
      .resize(1024, null, { withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const afterUpload = await uploadObject({
      bucket: BUCKET,
      key: `ai-templates/${template.slug}-after-${uuid()}.jpg`,
      body: afterBody,
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    const afterUrl = String(afterUpload.url || "").trim();
    if (!afterUrl) {
      return handleApiError(
        new Error("Public URL unavailable"),
        "Render succeeded but the image URL is unavailable.",
        500,
      );
    }

    const thumbUrl = await publishCardThumb(afterBody, "ai-templates", template.slug);

    let beforeUrl: string | null = null;
    if (normalizedInput) {
      const beforeBody = await sharp(normalizedInput)
        .resize(640, null, { withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const beforeUpload = await uploadObject({
        bucket: BUCKET,
        key: `ai-templates/${template.slug}-before-${uuid()}.jpg`,
        body: beforeBody,
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
        skipExistenceCheck: true,
      });
      beforeUrl = String(beforeUpload.url || "").trim() || null;
    }

    const updated = await prisma.aiTemplate.update({
      where: { id },
      data: { afterUrl, beforeUrl, thumbUrl },
    });

    logger.info("AI template art generated", {
      userId: session.userId,
      slug: template.slug,
      model: rendered.model,
      predictionId: rendered.predictionId,
    });
    return NextResponse.json({ ok: true, template: updated });
  } catch (error) {
    return handleApiError(error, "Failed to generate the template art.");
  }
}
