function normalizeServerUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return "";
  }
}

function uniqueServers(...urls) {
  const seen = new Set();
  const result = [];
  urls
    .map((url) => normalizeServerUrl(url))
    .filter(Boolean)
    .forEach((url) => {
      if (seen.has(url)) return;
      seen.add(url);
      result.push({ url });
    });
  return result;
}

const localeHeaderParameters = [
  {
    name: "x-lang",
    in: "header",
    required: false,
    description: "Preferred response language from mobile app (`en` or `ar`).",
    schema: {
      type: "string",
      enum: ["en", "ar"],
    },
  },
  {
    name: "lang",
    in: "header",
    required: false,
    description: "Fallback language header (`en` or `ar`).",
    schema: {
      type: "string",
      enum: ["en", "ar"],
    },
  },
  {
    name: "accept-language",
    in: "header",
    required: false,
    description: "Standard locale header. Only `en` and `ar` are recognized.",
    schema: {
      type: "string",
      example: "en-US,en;q=0.9",
    },
  },
  {
    name: "x-client-platform",
    in: "header",
    required: false,
    description: "Optional client platform marker from app (for example `android` or `ios`).",
    schema: {
      type: "string",
      example: "android",
    },
  },
];

const localeQueryParameters = [
  {
    name: "lang",
    in: "query",
    required: false,
    description: "Language override (`en` or `ar`) when language headers are not sent.",
    schema: {
      type: "string",
      enum: ["en", "ar"],
    },
  },
  {
    name: "locale",
    in: "query",
    required: false,
    description: "Alternative query language override (`en` or `ar`).",
    schema: {
      type: "string",
      enum: ["en", "ar"],
    },
  },
];

const reusableParameters = {
  templateIdPath: {
    name: "id",
    in: "path",
    required: true,
    description: "Template UUID (slug is accepted for backward compatibility).",
    schema: {
      type: "string",
    },
  },
  categoryId: {
    name: "categoryId",
    in: "query",
    required: false,
    description: "Category GUID (recommended).",
    schema: {
      type: "string",
      format: "uuid",
    },
  },
  subCategoryId: {
    name: "subCategoryId",
    in: "query",
    required: false,
    description: "Sub category GUID (recommended).",
    schema: {
      type: "string",
      format: "uuid",
    },
  },
  query: {
    name: "query",
    in: "query",
    required: false,
    description: "Template name partial match (case-insensitive).",
    schema: {
      type: "string",
    },
  },
  tag: {
    name: "tag",
    in: "query",
    required: false,
    description: "Tag exact match (case-insensitive).",
    schema: {
      type: "string",
    },
  },
  limit: {
    name: "limit",
    in: "query",
    required: false,
    description: "Max templates to return (default 100, min 1, max 200).",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 100,
    },
  },
  templatesPage: {
    name: "page",
    in: "query",
    required: false,
    description: "1-based page index.",
    schema: {
      type: "integer",
      minimum: 1,
      default: 1,
    },
  },
  templatesPageSize: {
    name: "pageSize",
    in: "query",
    required: false,
    description: "Results per page (max 200). Aliases: `page_size`, `per_page`, `limit`.",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 100,
    },
  },
  templatesPerSubCategory: {
    name: "templatesPerSubCategory",
    in: "query",
    required: false,
    description:
      "Templates returned per sub category (default 10, max 50). Aliases: `templates_per_sub_category`, `perSubCategory`, `limit`.",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
  assetScope: {
    name: "scope",
    in: "query",
    required: false,
    description: "Asset scope. Defaults to `layer`.",
    schema: {
      type: "string",
      enum: ["layer", "background", "thumbnail"],
      default: "layer",
    },
  },
  assetField: {
    name: "field",
    in: "query",
    required: false,
    description: "Source field name to resolve from object/background.",
    schema: {
      type: "string",
      example: "src",
    },
  },
  assetElementId: {
    name: "elementId",
    in: "query",
    required: false,
    description: "Layer element id to locate source media.",
    schema: {
      type: "string",
    },
  },
  assetIndex: {
    name: "index",
    in: "query",
    required: false,
    description: "Layer index fallback when elementId is not provided.",
    schema: {
      type: "integer",
      minimum: 0,
    },
  },
  fontCategory: {
    name: "category",
    in: "query",
    required: false,
    description: "Filter fonts by category.",
    schema: {
      type: "string",
      enum: ["INSTALLED", "EXCLUSIVE", "ENGLISH", "ARABIC"],
    },
  },
  fontQuery: {
    name: "query",
    in: "query",
    required: false,
    description:
      "Legacy search query across font names, preview text, source, and categories. `search` is preferred.",
    schema: {
      type: "string",
    },
  },
  fontSearch: {
    name: "search",
    in: "query",
    required: false,
    description: "Search query across font names, preview text, source, and categories.",
    schema: {
      type: "string",
    },
  },
  fontLanguage: {
    name: "language",
    in: "query",
    required: false,
    description: "Filter fonts by language bucket.",
    schema: {
      type: "string",
      enum: ["ar", "en", "arabic", "english"],
    },
  },
  fontLang: {
    name: "lang",
    in: "query",
    required: false,
    description: "Alias for language filter.",
    schema: {
      type: "string",
      enum: ["ar", "en", "arabic", "english"],
    },
  },
  fontPage: {
    name: "page",
    in: "query",
    required: false,
    description: "1-based result page index. Page size is fixed at 100.",
    schema: {
      type: "integer",
      minimum: 1,
      default: 1,
    },
  },
  elementsQuery: {
    name: "query",
    in: "query",
    required: false,
    description: "Search imported elements by English/Arabic name and tags.",
    schema: {
      type: "string",
    },
  },
  elementsSearch: {
    name: "search",
    in: "query",
    required: false,
    description: "Alias for query search parameter.",
    schema: {
      type: "string",
    },
  },
  elementsQ: {
    name: "q",
    in: "query",
    required: false,
    description: "Short alias for query search parameter.",
    schema: {
      type: "string",
    },
  },
  elementsSource: {
    name: "source",
    in: "query",
    required: false,
    description: "Element source filter. Use `all` to include every source.",
    schema: {
      type: "string",
      enum: ["all", "freepik"],
      default: "all",
      example: "all",
    },
  },
  elementsKind: {
    name: "kind",
    in: "query",
    required: false,
    description: "Element kind filter.",
    schema: {
      type: "string",
      enum: ["all", "icon", "vector", "image"],
      default: "all",
    },
  },
  elementsPage: {
    name: "page",
    in: "query",
    required: false,
    description: "1-based page index.",
    schema: {
      type: "integer",
      minimum: 1,
      default: 1,
    },
  },
  elementsPageSize: {
    name: "pageSize",
    in: "query",
    required: false,
    description: "Results per page (max 100). Aliases: `page_size`, `per_page`, `limit`.",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 100,
    },
  },
  fontIdPath: {
    name: "id",
    in: "path",
    required: true,
    description: "Custom font id.",
    schema: {
      type: "string",
    },
  },
};

const schemas = {
  ErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
    },
  },
  CategoryOption: {
    type: "object",
    required: ["id", "value", "label", "labelEn", "labelAr", "published", "subCategories"],
    properties: {
      id: { type: "string", format: "uuid" },
      value: { type: "string" },
      label: { type: "string" },
      labelEn: { type: "string" },
      labelAr: { type: "string" },
      published: { type: "boolean" },
      subCategories: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SubCategoryOption",
        },
      },
    },
  },
  SubCategoryOption: {
    type: "object",
    required: ["id", "categoryId", "value", "label", "labelEn", "labelAr", "published"],
    properties: {
      id: { type: "string", format: "uuid" },
      categoryId: { type: "string", format: "uuid" },
      value: { type: "string" },
      label: { type: "string" },
      labelEn: { type: "string" },
      labelAr: { type: "string" },
      published: { type: "boolean" },
    },
  },
  MobileProject: {
    type: "object",
    required: [
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "canvasWidth",
      "canvasHeight",
      "background",
      "layers",
      "meta",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      createdAt: { type: "integer", format: "int64" },
      updatedAt: { type: "integer", format: "int64" },
      canvasWidth: { type: "number" },
      canvasHeight: { type: "number" },
      background: {
        type: "object",
        additionalProperties: true,
      },
      layers: {
        type: "array",
        description:
          "Project layers. TEXT layers include a `font` object with resolved font download metadata (`downloadUrl`, `mobileDownloadUrl`, compatibility, and source).",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      meta: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
  MobileTemplateSummary: {
    type: "object",
    required: [
      "id",
      "title",
      "version",
      "updatedAt",
      "canvasWidth",
      "canvasHeight",
      "category",
      "subCategory",
      "categoryId",
      "categoryValue",
      "subCategoryId",
      "subCategoryValue",
      "thumbnailUrl",
      "thumbnailDataUrl",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      version: { type: "integer" },
      updatedAt: { type: "integer", format: "int64" },
      canvasWidth: { type: "number" },
      canvasHeight: { type: "number" },
      category: { type: "string", description: "Localized category label." },
      subCategory: { type: "string", description: "Localized sub category label." },
      categoryId: { type: "string", format: "uuid" },
      categoryValue: { type: "string" },
      subCategoryId: { type: "string", format: "uuid" },
      subCategoryValue: { type: "string" },
      thumbnailUrl: { type: "string" },
      thumbnailDataUrl: { type: "string" },
    },
  },
  MobileTemplateDetail: {
    allOf: [
      {
        $ref: "#/components/schemas/MobileTemplateSummary",
      },
      {
        type: "object",
        required: ["project"],
        properties: {
          project: {
            $ref: "#/components/schemas/MobileProject",
          },
        },
      },
    ],
  },
  TemplatesBySubCategoryGroup: {
    type: "object",
    required: [
      "category",
      "categoryId",
      "categoryValue",
      "subCategory",
      "subCategoryId",
      "subCategoryValue",
      "templates",
    ],
    properties: {
      category: { type: "string" },
      categoryId: { type: "string", format: "uuid" },
      categoryValue: { type: "string" },
      subCategory: { type: "string" },
      subCategoryId: { type: "string", format: "uuid" },
      subCategoryValue: { type: "string" },
      templates: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileTemplateSummary",
        },
      },
    },
  },
  TaxonomyResponse: {
    type: "object",
    required: ["locale", "categories"],
    properties: {
      locale: {
        type: "string",
        enum: ["en", "ar"],
      },
      categories: {
        type: "array",
        items: {
          $ref: "#/components/schemas/CategoryOption",
        },
      },
    },
  },
  TemplateListResponse: {
    type: "object",
    required: [
      "locale",
      "categories",
      "templatesBySubCategory",
      "page",
      "pageSize",
      "total",
      "totalPages",
      "hasNextPage",
      "hasPrevPage",
    ],
    properties: {
      locale: {
        type: "string",
        enum: ["en", "ar"],
      },
      categories: {
        type: "array",
        items: {
          $ref: "#/components/schemas/CategoryOption",
        },
      },
      templatesBySubCategory: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TemplatesBySubCategoryGroup",
        },
      },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1 },
      total: { type: "integer", minimum: 0 },
      totalPages: { type: "integer", minimum: 1 },
      hasNextPage: { type: "boolean" },
      hasPrevPage: { type: "boolean" },
    },
  },
  TemplateByIdResponse: {
    type: "object",
    required: ["locale", "template"],
    properties: {
      locale: {
        type: "string",
        enum: ["en", "ar"],
      },
      template: {
        $ref: "#/components/schemas/MobileTemplateDetail",
      },
    },
  },
  BySubCategoryTemplatesGroup: {
    type: "object",
    required: ["category", "subCategory", "templates"],
    properties: {
      category: {
        type: "object",
        required: ["id", "value", "label"],
        properties: {
          id: { type: "string", format: "uuid" },
          value: { type: "string" },
          label: { type: "string" },
        },
      },
      subCategory: {
        type: "object",
        required: ["id", "categoryId", "value", "label"],
        properties: {
          id: { type: "string", format: "uuid" },
          categoryId: { type: "string", format: "uuid" },
          value: { type: "string" },
          label: { type: "string" },
        },
      },
      templates: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileTemplateSummary",
        },
      },
    },
  },
  BySubCategoryResponse: {
    type: "object",
    required: ["locale", "templatesPerSubCategory", "subCategories"],
    properties: {
      locale: {
        type: "string",
        enum: ["en", "ar"],
      },
      templatesPerSubCategory: {
        type: "integer",
        minimum: 1,
        example: 10,
      },
      subCategories: {
        type: "array",
        items: {
          $ref: "#/components/schemas/BySubCategoryTemplatesGroup",
        },
      },
    },
  },
  MobileFont: {
    type: "object",
    required: [
      "id",
      "fontName",
      "displayName",
      "previewText",
      "categories",
      "previewWeight",
      "cssFontFamily",
      "mobileCompatible",
      "downloadUrl",
      "source",
    ],
    properties: {
      id: { type: "string" },
      fontName: { type: "string" },
      displayName: { type: "string" },
      previewText: { type: "string" },
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: ["INSTALLED", "EXCLUSIVE", "ENGLISH", "ARABIC"],
        },
      },
      previewWeight: { type: "integer" },
      cssFontFamily: { type: "string" },
      downloadUrl: {
        type: "string",
        nullable: true,
        description:
          "Legacy mobile font download URL. Mirrors `mobileDownloadUrl`.",
      },
      mobileDownloadUrl: {
        type: "string",
        nullable: true,
        description:
          "Mobile-safe download URL. Null when the source font format is incompatible with mobile runtime loading.",
      },
      mobileCompatible: {
        type: "boolean",
        description: "Whether this font is directly compatible with mobile runtime loading (ttf/otf/ttc).",
      },
      fontFormat: {
        type: "string",
        nullable: true,
        enum: ["ttf", "otf", "ttc", "woff", "woff2", "eot", "unknown"],
        description: "Detected source font format.",
      },
      sourceMimeType: {
        type: "string",
        nullable: true,
        description: "Detected source MIME type for the font asset.",
      },
      source: {
        type: "string",
        description: "Font source bucket (`custom`, `google`, `fontsource`, `openfontlibrary`, or `synced`).",
      },
    },
  },
  MobileFontsResponse: {
    type: "object",
    required: [
      "fonts",
      "page",
      "pageSize",
      "total",
      "totalPages",
      "hasNextPage",
      "hasPrevPage",
    ],
    properties: {
      fonts: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileFont",
        },
      },
      page: {
        type: "integer",
        minimum: 1,
      },
      pageSize: {
        type: "integer",
        minimum: 1,
        example: 100,
      },
      total: {
        type: "integer",
        minimum: 0,
      },
      totalPages: {
        type: "integer",
        minimum: 1,
      },
      hasNextPage: {
        type: "boolean",
      },
      hasPrevPage: {
        type: "boolean",
      },
    },
  },
  MobileElement: {
    type: "object",
    required: [
      "id",
      "source",
      "sourceAssetId",
      "kind",
      "name",
      "nameEn",
      "nameAr",
      "tags",
      "tagsEn",
      "tagsAr",
      "assetUrl",
      "thumbnailUrl",
    ],
    properties: {
      id: { type: "string" },
      source: { type: "string", example: "freepik" },
      sourceAssetId: { type: "string", example: "13643078" },
      kind: { type: "string", enum: ["icon", "vector", "image"] },
      name: { type: "string" },
      nameEn: { type: "string" },
      nameAr: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      tagsEn: {
        type: "array",
        items: { type: "string" },
      },
      tagsAr: {
        type: "array",
        items: { type: "string" },
      },
      labels: {
        type: "array",
        items: { type: "string" },
      },
      labelsEn: {
        type: "array",
        items: { type: "string" },
      },
      labelsAr: {
        type: "array",
        items: { type: "string" },
      },
      slug: { type: "string", nullable: true },
      assetUrl: { type: "string", format: "uri" },
      thumbnailUrl: { type: "string", format: "uri" },
      width: { type: "integer", nullable: true },
      height: { type: "integer", nullable: true },
      freeSvg: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  MobileElementsResponse: {
    type: "object",
    required: [
      "locale",
      "elements",
      "page",
      "pageSize",
      "total",
      "totalPages",
      "hasNextPage",
      "hasPrevPage",
    ],
    properties: {
      locale: {
        type: "string",
        enum: ["en", "ar"],
      },
      elements: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileElement",
        },
      },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1 },
      total: { type: "integer", minimum: 0 },
      totalPages: { type: "integer", minimum: 1 },
      hasNextPage: { type: "boolean" },
      hasPrevPage: { type: "boolean" },
    },
  },
};

export function buildMobileOpenApiSpec(serverOrigin) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Web Dashboard Mobile Templates API",
      version: "1.0.0",
      description:
        "Public mobile APIs for published templates, taxonomy, and template detail. No authorization is required for /api/mobile routes.",
    },
    servers: uniqueServers(serverOrigin, process.env.NEXT_PUBLIC_APP_URL, "http://127.0.0.1:3000"),
    tags: [
      { name: "Mobile Templates" },
      { name: "Mobile Fonts" },
      { name: "Mobile Elements" },
    ],
    paths: {
      "/api/mobile/templates": {
        get: {
          tags: ["Mobile Templates"],
          summary: "List published templates",
          description:
            "Returns grouped, localized template summaries. Use template id with /api/mobile/templates/{id} to fetch the full project payload.",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.categoryId,
            reusableParameters.subCategoryId,
            reusableParameters.query,
            reusableParameters.tag,
            reusableParameters.templatesPage,
            reusableParameters.templatesPageSize,
          ],
          responses: {
            200: {
              description: "Published templates response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/TemplateListResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/templates/{id}": {
        get: {
          tags: ["Mobile Templates"],
          summary: "Get published template by id",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.templateIdPath,
          ],
          responses: {
            200: {
              description: "Template details",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/TemplateByIdResponse",
                  },
                },
              },
            },
            400: {
              description: "Missing template id/slug",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            404: {
              description: "Template not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/templates/{id}/assets": {
        get: {
          tags: ["Mobile Templates"],
          summary: "Resolve template asset URL or bytes",
          description:
            "Resolves template thumbnail/background/layer media referenced in published template data.",
          parameters: [
            reusableParameters.templateIdPath,
            reusableParameters.assetScope,
            reusableParameters.assetField,
            reusableParameters.assetElementId,
            reusableParameters.assetIndex,
          ],
          responses: {
            200: {
              description: "Asset bytes",
              content: {
                "application/octet-stream": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
                "image/*": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
                "video/*": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
            307: {
              description: "Redirect to remote asset URL",
            },
            400: {
              description: "Missing template id/slug",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            404: {
              description: "Template or asset not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            422: {
              description: "Unsupported asset source",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/templates/taxonomy": {
        get: {
          tags: ["Mobile Templates"],
          summary: "Get localized taxonomy options",
          parameters: [...localeHeaderParameters, ...localeQueryParameters],
          responses: {
            200: {
              description: "Taxonomy options",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/TaxonomyResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/templates/by-subcategory": {
        get: {
          tags: ["Mobile Templates"],
          summary: "List published templates grouped by sub category",
          description:
            "Returns every configured sub category with its latest templates (default 10 per sub category).",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.categoryId,
            reusableParameters.subCategoryId,
            reusableParameters.query,
            reusableParameters.tag,
            reusableParameters.templatesPerSubCategory,
          ],
          responses: {
            200: {
              description: "Templates grouped by sub category",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/BySubCategoryResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid categoryId or subCategoryId",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/elements": {
        get: {
          tags: ["Mobile Elements"],
          summary: "List imported editor elements",
          description:
            "Returns imported elements (for example Freepik icons) with localized name/tags and pagination.",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.elementsQuery,
            reusableParameters.elementsSearch,
            reusableParameters.elementsQ,
            reusableParameters.elementsSource,
            reusableParameters.elementsKind,
            reusableParameters.elementsPage,
            reusableParameters.elementsPageSize,
          ],
          responses: {
            200: {
              description: "Imported elements response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileElementsResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/fonts": {
        get: {
          tags: ["Mobile Fonts"],
          summary: "List mobile fonts",
          description:
            "Returns mobile font catalog merged with custom uploaded fonts and synced source fonts. Supports search/category/language filtering and pagination.",
          parameters: [
            reusableParameters.fontSearch,
            reusableParameters.fontQuery,
            reusableParameters.fontCategory,
            reusableParameters.fontLanguage,
            reusableParameters.fontLang,
            reusableParameters.fontPage,
          ],
          responses: {
            200: {
              description: "Font list",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFontsResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/fonts/{id}/file": {
        get: {
          tags: ["Mobile Fonts"],
          summary: "Resolve mobile font file",
          description:
            "Returns mobile-compatible font bytes for a font id, or redirects to the stored file URL when available. Unsupported formats return 415.",
          parameters: [reusableParameters.fontIdPath],
          responses: {
            200: {
              description: "Font bytes",
              content: {
                "application/octet-stream": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
                "font/*": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
            307: {
              description: "Redirect to remote font URL",
            },
            400: {
              description: "Missing font id",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            404: {
              description: "Font not found or missing font data",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            415: {
              description: "Font exists but format is not supported on mobile",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas,
    },
  };
}
