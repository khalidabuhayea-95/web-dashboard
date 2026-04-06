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

const mobileSigningHeaderParameters = [
  {
    name: "x-mobile-key",
    in: "header",
    required: false,
    description: "Mobile request signing key id. Required when mobile signing is enabled for write routes.",
    schema: {
      type: "string",
      example: "mobile-client-1",
    },
  },
  {
    name: "x-mobile-ts",
    in: "header",
    required: false,
    description: "Unix timestamp used for mobile request signing. Required when mobile signing is enabled.",
    schema: {
      type: "string",
      example: "1742995200000",
    },
  },
  {
    name: "x-mobile-sign",
    in: "header",
    required: false,
    description: "HMAC request signature. Required when mobile signing is enabled.",
    schema: {
      type: "string",
      example: "8c2d6a2b2ca6c3d3f0a5280c0d0e67f9537a2d8c60b5d54c8ef7088ccf205962",
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
    description: "Search imported elements by English/Arabic name, tags, and labels.",
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
  shapesQuery: {
    name: "query",
    in: "query",
    required: false,
    description: "Search built-in shapes by name, id, and keywords.",
    schema: {
      type: "string",
    },
  },
  shapesSearch: {
    name: "search",
    in: "query",
    required: false,
    description: "Alias for query search parameter.",
    schema: {
      type: "string",
    },
  },
  shapesQ: {
    name: "q",
    in: "query",
    required: false,
    description: "Short alias for query search parameter.",
    schema: {
      type: "string",
    },
  },
  shapesPage: {
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
  shapesPageSize: {
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
  shapeIdPath: {
    name: "id",
    in: "path",
    required: true,
    description: "Built-in shape id.",
    schema: {
      type: "string",
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
  backgroundCategoryIdPath: {
    name: "id",
    in: "path",
    required: true,
    description: "Background category id.",
    schema: {
      type: "string",
      format: "uuid",
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
  BackgroundCategoryOption: {
    type: "object",
    required: ["id", "value", "label", "thumbnailUrl", "published", "backgroundCount"],
    properties: {
      id: { type: "string", format: "uuid" },
      value: { type: "string" },
      label: { type: "string" },
      thumbnailUrl: { type: "string", format: "uri", nullable: true },
      published: { type: "boolean" },
      backgroundCount: { type: "integer", minimum: 0 },
    },
  },
  MobileBackgroundCategoriesResponse: {
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
          $ref: "#/components/schemas/BackgroundCategoryOption",
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
  MobileBackgroundImage: {
    type: "object",
    required: [
      "id",
      "source",
      "sourceAssetId",
      "category",
      "name",
      "nameEn",
      "nameAr",
      "tags",
      "tagsEn",
      "tagsAr",
      "assetUrl",
      "thumbnailUrl",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      source: { type: "string", example: "freepik-background" },
      sourceAssetId: { type: "string", example: "425309375" },
      category: { type: "string" },
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
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  MobileBackgroundImageUrl: {
    type: "object",
    required: ["previewUrl", "url"],
    properties: {
      previewUrl: { type: "string", format: "uri" },
      url: { type: "string", format: "uri" },
    },
  },
  MobileShape: {
    type: "object",
    required: [
      "id",
      "name",
      "nameEn",
      "tags",
      "tagsEn",
      "tagsAr",
      "assetUrl",
      "thumbnailUrl",
      "width",
      "height",
    ],
    properties: {
      id: { type: "string" },
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
      assetUrl: { type: "string", format: "uri" },
      thumbnailUrl: { type: "string", format: "uri" },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
    },
  },
  MobileShapesResponse: {
    type: "object",
    required: [
      "locale",
      "shapes",
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
      shapes: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileShape",
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
        "Mobile APIs for published templates, elements, fonts, and media tools. Read-oriented routes are public; write-heavy media routes may require signed mobile headers.",
    },
    servers: uniqueServers(serverOrigin, process.env.NEXT_PUBLIC_APP_URL, "http://127.0.0.1:3000"),
    tags: [
      { name: "Mobile Templates" },
      { name: "Mobile Fonts" },
      { name: "Mobile Elements" },
      { name: "Mobile Shapes" },
      { name: "Mobile Media" },
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
            "Returns imported elements (for example Freepik icons) with localized name, tags, and labels. Search matches both English and Arabic fields.",
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
      "/api/mobile/background-categories": {
        get: {
          tags: ["Mobile Backgrounds"],
          summary: "List localized background categories",
          description:
            "Returns every published background category with its localized label, optional thumbnail, and imported image count.",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            {
              name: "source",
              in: "query",
              required: false,
              description: "Background source filter. Defaults to `all`.",
              schema: {
                type: "string",
                example: "all",
              },
            },
          ],
          responses: {
            200: {
              description: "Background categories response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileBackgroundCategoriesResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/background-categories/{id}/images": {
        get: {
          tags: ["Mobile Backgrounds"],
          summary: "List all background images for one category",
          description:
            "Returns every imported background image for a single category id without pagination.",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.backgroundCategoryIdPath,
            {
              name: "source",
              in: "query",
              required: false,
              description: "Background source filter. Defaults to `all`.",
              schema: {
                type: "string",
                example: "all",
              },
            },
          ],
          responses: {
            200: {
              description: "Background image URL list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/MobileBackgroundImageUrl",
                    },
                  },
                },
              },
            },
            404: {
              description: "Background category not found",
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
      "/api/mobile/shapes": {
        get: {
          tags: ["Mobile Shapes"],
          summary: "List built-in editor shapes",
          description:
            "Returns the built-in editor shapes as a flat paginated list for mobile clients. Shapes are not grouped by category in this response.",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.shapesQuery,
            reusableParameters.shapesSearch,
            reusableParameters.shapesQ,
            reusableParameters.shapesPage,
            reusableParameters.shapesPageSize,
          ],
          responses: {
            200: {
              description: "Built-in shapes response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileShapesResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/shapes/{id}/file": {
        get: {
          tags: ["Mobile Shapes"],
          summary: "Resolve built-in shape image",
          description:
            "Renders a built-in editor shape as a PNG image for mobile clients.",
          parameters: [reusableParameters.shapeIdPath],
          responses: {
            200: {
              description: "Shape PNG image",
              content: {
                "image/png": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
            404: {
              description: "Shape not found",
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
      "/api/mobile/media/remove-background": {
        post: {
          tags: ["Mobile Media"],
          summary: "Remove image background",
          description:
            "Accepts a single PNG or JPEG upload and returns a transparent PNG. This route uses the local rembg runtime as the primary remover and automatically falls back to the legacy local remover when rembg cannot safely process the image. This route is currently public and does not require mobile signing headers.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Background-removed PNG image",
              content: {
                "image/png": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
            400: {
              description: "Invalid multipart payload or missing file",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            413: {
              description: "Image file is too large",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            415: {
              description: "Unsupported image type",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            422: {
              description: "Background could not be isolated",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Background removal failed",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            503: {
              description: "Background removal engine unavailable",
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
      "/api/mobile/media/object-remove": {
        post: {
          tags: ["Mobile Media"],
          summary: "Remove object from image",
          description:
            "Accepts an image plus a same-size binary mask, stages both inputs privately for Replicate, waits for the object-removal model to finish, and returns the edited image directly in the response.",
          parameters: [...mobileSigningHeaderParameters],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["image", "mask"],
                  properties: {
                    image: {
                      type: "string",
                      format: "binary",
                    },
                    mask: {
                      type: "string",
                      format: "binary",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Object-removed image",
              content: {
                "image/png": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
                "image/jpeg": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
                "image/webp": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
            400: {
              description: "Invalid multipart payload, empty uploads, or mismatched image and mask dimensions",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid mobile signature",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            413: {
              description: "Image or mask file is too large",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            415: {
              description: "Unsupported image or mask type",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            422: {
              description: "Image or mask could not be processed safely",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            503: {
              description: "Replicate object removal is unavailable",
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
