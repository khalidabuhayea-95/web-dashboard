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

export function isDataUri(value) {
  return /^data:[^;]+;base64,/i.test(String(value || "").trim());
}
