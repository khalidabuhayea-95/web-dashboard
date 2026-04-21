import {
  getPublicObjectProxyUrl,
  parsePublicObjectKey,
} from "@/lib/storage/objectStorage.server";

export function createTemplateAssetResolver(request, template) {
  const templateId = String(template?.id || "").trim();
  if (!templateId) return null;

  const baseUrl = new URL(
    `/api/mobile/templates/${encodeURIComponent(templateId)}/assets`,
    request.url
  );

  return ({ scope = "layer", elementId = "", index = null, field = "" } = {}) => {
    const url = new URL(baseUrl.toString());
    if (scope) url.searchParams.set("scope", String(scope));
    if (elementId) url.searchParams.set("elementId", String(elementId));
    if (Number.isFinite(Number(index))) {
      url.searchParams.set("index", String(Number(index)));
    }
    if (field) url.searchParams.set("field", String(field));
    return url.toString();
  };
}

export function createMobilePublicMediaUrlResolver(request) {
  const origin = new URL(request.url).origin;

  return (value) => {
    const source = String(value || "").trim();
    if (!source) return "";

    const key = parsePublicObjectKey(source);
    if (!key) return source;

    let search = "";
    try {
      search = new URL(source, origin).search;
    } catch {
      search = "";
    }

    const resolved = new URL(getPublicObjectProxyUrl(key), origin);
    if (search) resolved.search = search;
    return resolved.toString();
  };
}

export function isDataUri(value) {
  return /^data:[^;]+;base64,/i.test(String(value || "").trim());
}
