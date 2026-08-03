import { cache } from "react";
import { headers } from "next/headers";

import prisma from "@/lib/prisma";
import { resolveTemplateAudience } from "@/lib/mobile/templateAudience.server";
import {
  createMobilePublicMediaUrlResolver,
  createTemplateAssetResolver,
  isDataUri,
} from "@/lib/mobile/templateAssets";
import {
  isTemplateAllowedByTaxonomy,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
} from "@/lib/mobile/taxonomy";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";
import { appendVersionParam } from "@/lib/storage/objectStorage.server";
import { buildTemplateShareUrl } from "@/lib/shareLink";

/**
 * Loader behind the public /t/<ref> landing page.
 *
 * Resolution mirrors src/app/api/mobile/templates/[slug]/route.js exactly —
 * uuid-or-slug lookup, `resolveTemplateAudience().statusWhere` instead of a
 * hard-coded `status: "published"`, then `isTemplateAllowedByTaxonomy`. A
 * template the mobile app cannot open must not be visible here either.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The landing page is Arabic-first, like the rest of the public site. */
const SHARE_LOCALE = "ar";

/**
 * Formats a link preview crawler will actually render. SVG is excluded on
 * purpose: /api/storage/public/[...key] rewrites svg/xml/html/js to
 * octet-stream + attachment, so an svg thumbnail can never be an og:image.
 */
const OG_IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
]);

const ALLOWED_OG_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function resolveRequestOrigin(requestHeaders) {
  const host =
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const forwardedProto = String(requestHeaders.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The mobile helpers (`resolveTemplateAudience`, the asset resolvers) all take a
 * `Request`. A server component does not get one, so build the minimal
 * equivalent: the real origin plus the only header the audience check reads.
 */
async function buildRequestLike(ref) {
  const requestHeaders = await headers();
  const origin = resolveRequestOrigin(requestHeaders);
  const forwardedHeaders = new Headers();
  const authorization = requestHeaders.get("authorization");
  if (authorization) forwardedHeaders.set("authorization", authorization);

  return new Request(`${origin}/t/${encodeURIComponent(ref)}`, {
    headers: forwardedHeaders,
  });
}

function guessImageMimeType(url) {
  const path = String(url || "").split("?")[0];
  const extension = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
  return OG_IMAGE_TYPES.get(extension) || "";
}

function dataUriMimeType(value) {
  const match = String(value || "").match(/^data:([^;,]+)/i);
  return match ? String(match[1]).trim().toLowerCase() : "";
}

function templateVersionToken(template) {
  const updatedAt =
    template?.updatedAt instanceof Date ? template.updatedAt.getTime() : Number.NaN;
  return Number.isFinite(updatedAt) ? String(updatedAt) : "";
}

function toAbsoluteUrl(value, origin) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    return new URL(source, origin).toString();
  } catch {
    return "";
  }
}

/**
 * Same thumbnail the mobile API hands the app: a stored URL goes through the
 * public object proxy, a legacy data-URI thumbnail goes through the template
 * assets endpoint (the payload itself is far too large to inline in HTML).
 */
function resolveShareImage(request, template) {
  const origin = new URL(request.url).origin;
  const raw = String(template?.thumbnailDataUrl || "").trim();
  if (!raw) return { url: "", mimeType: "" };

  if (isDataUri(raw)) {
    const assetResolver = createTemplateAssetResolver(request, template);
    const url = assetResolver
      ? assetResolver({ scope: "thumbnail", field: "thumbnailDataUrl" })
      : "";
    return { url: toAbsoluteUrl(url, origin), mimeType: dataUriMimeType(raw) };
  }

  // Same cache-busting token the mobile detail route uses, so an edited
  // template gets a fresh preview instead of a stale cached one.
  const versioned = appendVersionParam(raw, templateVersionToken(template));
  const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
  const resolved = String(mediaUrlResolver(versioned) || versioned);
  const url = toAbsoluteUrl(resolved, origin);
  return { url, mimeType: guessImageMimeType(url) };
}

function readCanvasSize(canvasSize) {
  const width = Number(canvasSize?.width);
  const height = Number(canvasSize?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Resolves a share reference to the data the landing page renders, or null when
 * the template does not exist, is not visible to this caller, or sits in a
 * category the mobile taxonomy has unpublished.
 *
 * Wrapped in React `cache` so `generateMetadata` and the page body share one
 * database round-trip per request.
 *
 * @param {string} rawRef Template uuid or slug.
 */
export const loadSharedTemplate = cache(async (rawRef) => {
  const ref = String(rawRef ?? "").trim();
  if (!ref) return null;

  const request = await buildRequestLike(ref);
  const audience = await resolveTemplateAudience(request);
  const where = UUID_PATTERN.test(ref) ? { id: ref } : { slug: ref };

  const template = await prisma.template.findFirst({
    where: {
      ...audience.statusWhere,
      ...where,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      category: true,
      subCategory: true,
      canvasSize: true,
      thumbnailDataUrl: true,
      updatedAt: true,
    },
  });

  if (!template) return null;

  const taxonomy = prepareMobileTaxonomy(await getTemplateTaxonomySettings());
  if (!isTemplateAllowedByTaxonomy(template, taxonomy)) return null;

  const localized = localizeTemplateTaxonomy(template, taxonomy, SHARE_LOCALE);
  const image = resolveShareImage(request, template);
  const shareRef = String(template.slug || "").trim() || template.id;

  return {
    id: template.id,
    slug: template.slug || "",
    title: String(template.name || "").trim(),
    status: String(template.status || ""),
    isDraft: String(template.status || "") !== "published",
    categoryLabel: localized.categoryLabel || "",
    subCategoryLabel: localized.subCategoryLabel || "",
    canvas: readCanvasSize(template.canvasSize),
    imageUrl: image.url,
    // Only a format link previews actually render is advertised as og:image.
    ogImageUrl: ALLOWED_OG_MIME_TYPES.has(image.mimeType) ? image.url : "",
    ogImageType: ALLOWED_OG_MIME_TYPES.has(image.mimeType) ? image.mimeType : "",
    shareUrl: buildTemplateShareUrl(shareRef),
    // Custom-scheme form of the same link. The app registers `nayroz://` on both platforms
    // (AndroidManifest intent-filter + iOS CFBundleURLTypes), and unlike the https URL it still
    // opens the app when tapped from a page already served by nayroz.com — iOS deliberately does
    // not fire a Universal Link for a same-domain navigation.
    appUrl: `nayroz://template?id=${encodeURIComponent(shareRef)}`,
  };
});
