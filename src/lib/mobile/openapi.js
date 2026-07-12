// Optional push-registration fields accepted by the mobile auth endpoints so a
// device's FCM token can be captured during login/refresh/logout.
const DEVICE_PUSH_FIELDS = {
  deviceToken: {
    type: "string",
    description:
      "Optional FCM registration token. When present, the backend registers this device for push notifications.",
  },
  devicePlatform: {
    type: "string",
    enum: ["android", "ios"],
    description: "Optional device platform for the FCM token (defaults to android).",
  },
  appVersion: {
    type: "string",
    description: "Optional app version string for diagnostics.",
  },
};

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
  favoriteTemplateIdPath: {
    name: "templateId",
    in: "path",
    required: true,
    description: "Template UUID to favorite, check, or remove.",
    schema: {
      type: "string",
      format: "uuid",
    },
  },
  favoritesPageSize: {
    name: "pageSize",
    in: "query",
    required: false,
    description: "Results per page (default 50, min 1, max 100). Aliases: `page_size`, `per_page`, `limit`.",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 50,
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
  appSettingsDeviceType: {
    name: "deviceType",
    in: "query",
    required: true,
    description: "Mobile device type to evaluate (`android` or `ios`).",
    schema: {
      type: "string",
      enum: ["android", "ios"],
      example: "android",
    },
  },
  appSettingsAppVersion: {
    name: "appVersion",
    in: "query",
    required: true,
    description: "Mobile app integer version code (for example `205`).",
    schema: {
      type: "integer",
      minimum: 0,
      example: 205,
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
  MobileAppSettingsResponse: {
    type: "object",
    required: ["deviceType", "appVersion", "forceUpdate", "enableCache", "redirectLink"],
    properties: {
      deviceType: {
        type: "string",
        enum: ["android", "ios"],
      },
      appVersion: {
        type: "integer",
        minimum: 0,
        example: 205,
      },
      forceUpdate: { type: "boolean" },
      enableCache: { type: "boolean" },
      redirectLink: { type: "string", nullable: true, example: "https://play.google.com/store/apps/details?id=com.example.app" },
      fontsVersion: {
        type: "integer",
        minimum: 1,
        example: 7,
        description:
          "Monotonic version of the font catalog. Increments whenever fonts are added, updated, deleted, or previews are (re)generated by any method. Cache the full `/api/mobile/fonts` list locally and only re-fetch when this value changes.",
      },
    },
  },
  MobileAuthUser: {
    type: "object",
    required: ["id", "emailVerified"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
      emailVerified: { type: "boolean" },
    },
  },
  MobileAuthSessionResponse: {
    type: "object",
    required: ["tokenType", "accessToken", "refreshToken", "expiresInSeconds", "user"],
    properties: {
      tokenType: { type: "string", example: "Bearer" },
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      expiresInSeconds: { type: "integer", minimum: 1, example: 3600 },
      user: {
        $ref: "#/components/schemas/MobileAuthUser",
      },
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
          "Project layers. Every layer now includes `timelineStartMs`, `timelineEndMs`, and an `animation` object for mobile timeline rendering. TEXT layers include a `font` object with resolved font download metadata (`downloadUrl`, `mobileDownloadUrl`, compatibility, and source). FRAME layers include `shape`, `content`, and `contentTransform`; template frame image content is returned as a `previewOnly` frame-box PNG with zeroed content transform for mobile preview rendering.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            timelineStartMs: {
              type: "integer",
              format: "int32",
              description: "Layer visibility start on the template timeline in milliseconds.",
            },
            timelineEndMs: {
              type: "integer",
              format: "int32",
              description: "Layer visibility end on the template timeline in milliseconds.",
            },
            animation: {
              $ref: "#/components/schemas/MobileLayerAnimation",
            },
          },
        },
      },
      meta: {
        type: "object",
        additionalProperties: true,
        properties: {
          frameInfo: {
            $ref: "#/components/schemas/MobileTemplateFrameInfo",
          },
          compatibilityWarnings: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
  MobileTemplateFrameInfo: {
    type: "object",
    required: ["hasFrames", "count", "shapes", "frames", "message"],
    properties: {
      hasFrames: { type: "boolean" },
      count: { type: "integer" },
      shapes: {
        type: "array",
        items: { type: "string" },
      },
      frames: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name", "shape", "presetId", "shapeKind", "hasContent", "contentKind"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            shape: { type: "string" },
            presetId: { type: "string", nullable: true },
            shapeKind: { type: "string", nullable: true },
            hasContent: { type: "boolean" },
            contentKind: { type: "string", nullable: true },
          },
        },
      },
      message: {
        type: "string",
        example: "This template contains 1 frame: Circle.",
      },
    },
  },
  MobileLayerAnimation: {
    type: "object",
    required: ["type", "infinite", "durationMs", "delayMs", "direction", "easing", "intensity"],
    properties: {
      type: {
        type: "string",
        enum: [
          "NONE",
          "RISE",
          "PAN",
          "FADE",
          "POP",
          "WIPE",
          "BLUR",
          "SUCCESSION",
          "BREATHE",
          "BASELINE",
          "DRIFT",
          "TECTONIC",
          "TUMBLE",
          "NEON",
          "SCRAPBOOK",
          "STOMP",
          "ROTATE",
          "FLICKER",
          "PULSE",
          "WIGGLE",
        ],
      },
      infinite: { type: "boolean" },
      durationMs: { type: "integer", format: "int32" },
      delayMs: { type: "integer", format: "int32" },
      direction: {
        type: "string",
        enum: ["LEFT", "RIGHT", "UP", "DOWN", "CENTER", "CLOCKWISE", "COUNTERCLOCKWISE"],
      },
      easing: {
        type: "string",
        enum: ["LINEAR", "EASE_OUT", "EASE_IN_OUT", "SOFT_OUT", "SOFT_IN_OUT"],
      },
      intensity: { type: "number" },
    },
  },
  MobileTemplatePreview: {
    type: "object",
    required: ["status"],
    properties: {
      status: {
        type: "string",
        enum: ["not_requested", "queued", "processing", "ready", "failed"],
      },
      url: { type: "string", format: "uri", nullable: true },
      posterUrl: { type: "string", format: "uri", nullable: true },
      durationMs: { type: "integer", format: "int32", nullable: true },
      version: { type: "integer", format: "int32", nullable: true },
      updatedAt: { type: "integer", format: "int64", nullable: true },
      error: { type: "string", nullable: true },
    },
  },
  MobileTemplatePreviewSlim: {
    type: "object",
    required: ["status"],
    properties: {
      status: {
        type: "string",
        enum: ["not_requested", "queued", "processing", "ready", "failed"],
      },
      url: { type: "string", format: "uri", nullable: true },
      posterUrl: { type: "string", format: "uri", nullable: true },
      durationMs: { type: "integer", format: "int32", nullable: true },
    },
  },
  MobileLayerFontSummary: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid", nullable: true },
      fontName: { type: "string", nullable: true },
      displayName: { type: "string", nullable: true },
      downloadUrl: { type: "string", format: "uri", nullable: true },
      mobileDownloadUrl: { type: "string", format: "uri", nullable: true },
      mobileCompatible: { type: "boolean", nullable: true },
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
      previewVideoUrl: {
        type: "string",
        format: "uri",
        nullable: true,
        description:
          "Top-level alias for preview.url. When present, mobile can use this silent MP4 for motion-capable template previews.",
      },
      previewPosterUrl: {
        type: "string",
        format: "uri",
        nullable: true,
        description:
          "Top-level alias for preview.posterUrl. Use as the static fallback image for previewVideoUrl.",
      },
      preview: {
        allOf: [{ $ref: "#/components/schemas/MobileTemplatePreview" }],
        nullable: true,
      },
      frameInfo: {
        $ref: "#/components/schemas/MobileTemplateFrameInfo",
      },
      compatibilityWarnings: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  MobileTemplateBySubCategorySummary: {
    type: "object",
    required: [
      "id",
      "title",
      "canvasWidth",
      "canvasHeight",
      "thumbnailUrl",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      canvasWidth: { type: "number" },
      canvasHeight: { type: "number" },
      thumbnailUrl: { type: "string" },
      previewVideoUrl: {
        type: "string",
        format: "uri",
        nullable: true,
        description:
          "Present only when the mobile preview is ready. Mirrors `preview.url`.",
      },
      previewPosterUrl: {
        type: "string",
        format: "uri",
        nullable: true,
        description:
          "Present only when the mobile preview is ready and a poster image exists. Mirrors `preview.posterUrl`.",
      },
      preview: {
        type: "object",
        nullable: true,
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["ready"],
          },
          url: { type: "string", format: "uri", nullable: true },
          posterUrl: { type: "string", format: "uri", nullable: true },
          durationMs: { type: "integer", format: "int32", nullable: true },
        },
        description:
          "Included only when the generated mobile preview is ready.",
      },
    },
  },
  MobileTemplateDetail: {
    type: "object",
    required: [
      "id",
      "title",
      "category",
      "categoryValue",
      "subCategory",
      "subCategoryValue",
      "thumbnailUrl",
      "project",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      category: { type: "string", description: "Localized category label." },
      categoryValue: { type: "string" },
      subCategory: { type: "string", description: "Localized sub category label." },
      subCategoryValue: { type: "string" },
      thumbnailUrl: { type: "string" },
      preview: {
        allOf: [{ $ref: "#/components/schemas/MobileTemplatePreviewSlim" }],
        nullable: true,
      },
      project: {
        type: "object",
        required: ["canvasWidth", "canvasHeight", "background", "layers"],
        properties: {
          canvasWidth: { type: "number" },
          canvasHeight: { type: "number" },
          background: {
            type: "object",
            additionalProperties: true,
          },
          layers: {
            type: "array",
            description:
              "Project layers for editor/render state. Common fields include `id`, `type`, `transform` (center-based: `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `flipX`, `flipY`), `opacity`, `locked`, `hidden`, `zIndex`, `timelineStartMs`, `timelineEndMs`, and `animation`. Flip lives on the sign of `scaleX`/`scaleY` (negative = mirrored); `flipX`/`flipY` booleans restate that sign (`flipX === scaleX < 0`) — apply one, not both. TEXT layers expose a slim `font` object. FRAME layers expose `shape`, `content`, `contentTransform`, and `filters` without preset/name metadata.",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                font: {
                  $ref: "#/components/schemas/MobileLayerFontSummary",
                },
              },
            },
          },
        },
      },
    },
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
    required: ["template"],
    properties: {
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
        required: ["value", "label"],
        properties: {
          value: { type: "string" },
          label: { type: "string" },
        },
      },
      subCategory: {
        type: "object",
        required: ["value", "label"],
        properties: {
          value: { type: "string" },
          label: { type: "string" },
        },
      },
      templates: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileTemplateBySubCategorySummary",
        },
      },
    },
  },
  BySubCategoryResponse: {
    type: "object",
    required: ["subCategories"],
    properties: {
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
      previewImage: {
        type: "object",
        nullable: true,
        description:
          "Pre-rendered preview images of the font's sample text (transparent PNG). `light` has dark text for light backgrounds; `dark` has light text for dark backgrounds. Null until previews are generated in the admin console.",
        properties: {
          light: { type: "string", format: "uri", nullable: true },
          dark: { type: "string", format: "uri", nullable: true },
          updatedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
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
      "version",
      "fonts",
      "page",
      "pageSize",
      "total",
      "totalPages",
      "hasNextPage",
      "hasPrevPage",
    ],
    properties: {
      version: {
        type: "integer",
        minimum: 1,
        example: 7,
        description:
          "Font catalog version this list was generated at — matches `fontsVersion` from `/api/mobile/app-settings`. Store it alongside the cached list. By default the endpoint returns the entire catalog in one response (no pagination); pass `pageSize` to paginate.",
      },
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
  MobileFavoriteTemplateSummary: {
    type: "object",
    required: [
      "id",
      "title",
      "status",
      "category",
      "subCategory",
      "canvasWidth",
      "canvasHeight",
      "thumbnailUrl",
      "updatedAt",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      status: {
        type: "string",
        description: "Template lifecycle status (for example `published`).",
      },
      category: {
        type: "string",
        description: "Raw template category value (not localized).",
      },
      subCategory: {
        type: "string",
        description: "Raw template sub category value (not localized).",
      },
      canvasWidth: { type: "number" },
      canvasHeight: { type: "number" },
      thumbnailUrl: {
        type: "string",
        description: "URL to the template thumbnail asset.",
      },
      updatedAt: {
        type: "integer",
        format: "int64",
        description: "Template last-updated time (epoch milliseconds).",
      },
    },
  },
  MobileFavorite: {
    type: "object",
    required: ["id", "templateId", "favoritedAt", "template"],
    properties: {
      id: { type: "string", format: "uuid", description: "Favorite record id." },
      templateId: {
        type: "string",
        format: "uuid",
        description: "Favorited template id.",
      },
      favoritedAt: {
        type: "integer",
        format: "int64",
        description: "When the template was favorited (epoch milliseconds).",
      },
      template: {
        allOf: [{ $ref: "#/components/schemas/MobileFavoriteTemplateSummary" }],
        nullable: true,
        description: "Lightweight template summary; null when the template is no longer available.",
      },
    },
  },
  MobileFavoritesListResponse: {
    type: "object",
    required: [
      "favorites",
      "page",
      "pageSize",
      "total",
      "totalPages",
      "hasNextPage",
      "hasPrevPage",
    ],
    properties: {
      favorites: {
        type: "array",
        items: {
          $ref: "#/components/schemas/MobileFavorite",
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
  MobileFavoriteMutationResponse: {
    type: "object",
    required: ["favorite", "created"],
    properties: {
      favorite: {
        $ref: "#/components/schemas/MobileFavorite",
      },
      created: {
        type: "boolean",
        description: "True when this request created the favorite; false when it already existed.",
      },
    },
  },
  MobileFavoriteStatusResponse: {
    type: "object",
    required: ["isFavorite", "favorite"],
    properties: {
      isFavorite: { type: "boolean" },
      favorite: {
        allOf: [{ $ref: "#/components/schemas/MobileFavorite" }],
        nullable: true,
      },
    },
  },
  MobileFavoriteDeleteResponse: {
    type: "object",
    required: ["ok", "removed"],
    properties: {
      ok: { type: "boolean", example: true },
      removed: {
        type: "boolean",
        description: "True when a favorite was removed; false when the template was not favorited.",
      },
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
      { name: "Mobile App Settings" },
      { name: "Mobile Auth" },
      { name: "Mobile Templates" },
      { name: "Mobile Favorites" },
      { name: "Mobile Fonts" },
      { name: "Mobile Elements" },
      { name: "Mobile Shapes" },
      { name: "Mobile Media" },
    ],
    paths: {
      "/api/mobile/auth/google": {
        post: {
          tags: ["Mobile Auth"],
          summary: "Sign in mobile user with Google",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["idToken"],
                  properties: {
                    idToken: {
                      type: "string",
                      description: "Google ID token returned by the mobile app SDK.",
                    },
                    ...DEVICE_PUSH_FIELDS,
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Mobile auth session",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileAuthSessionResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid Google token or provider configuration",
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
      "/api/mobile/auth/facebook": {
        post: {
          tags: ["Mobile Auth"],
          summary: "Sign in mobile user with Facebook",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["accessToken"],
                  properties: {
                    accessToken: {
                      type: "string",
                      description: "Facebook access token returned by the mobile app SDK.",
                    },
                    ...DEVICE_PUSH_FIELDS,
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Mobile auth session",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileAuthSessionResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid Facebook token or provider configuration",
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
      "/api/mobile/auth/apple": {
        post: {
          tags: ["Mobile Auth"],
          summary: "Sign in mobile user with Apple on iOS",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["identityToken"],
                  properties: {
                    identityToken: {
                      type: "string",
                      description: "Apple identity token returned by native Sign in with Apple.",
                    },
                    name: {
                      type: "string",
                      description: "Optional display name sent by the app on first consent.",
                    },
                    ...DEVICE_PUSH_FIELDS,
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Mobile auth session",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileAuthSessionResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid Apple token or provider configuration",
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
      "/api/mobile/auth/refresh": {
        post: {
          tags: ["Mobile Auth"],
          summary: "Refresh mobile bearer session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["refreshToken"],
                  properties: {
                    refreshToken: {
                      type: "string",
                    },
                    ...DEVICE_PUSH_FIELDS,
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Rotated mobile auth session",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileAuthSessionResponse",
                  },
                },
              },
            },
            401: {
              description: "Refresh token invalid or expired",
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
      "/api/mobile/auth/logout": {
        post: {
          tags: ["Mobile Auth"],
          summary: "Revoke a mobile refresh token",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    refreshToken: { type: "string" },
                    deviceToken: {
                      type: "string",
                      description: "Optional FCM token to deactivate for this device on logout.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Logout result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok"],
                    properties: {
                      ok: { type: "boolean", example: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/mobile/auth/me": {
        get: {
          tags: ["Mobile Auth"],
          summary: "Get current mobile user from bearer token",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Current mobile user",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["user"],
                    properties: {
                      user: {
                        $ref: "#/components/schemas/MobileAuthUser",
                      },
                    },
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
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
      "/api/mobile/devices/token": {
        post: {
          tags: ["Mobile Auth"],
          summary: "Register or refresh the current device's FCM push token",
          description:
            "Authenticated endpoint for the app to register or rotate its FCM token (e.g. on FirebaseMessaging onNewToken). Associates the token with the signed-in user. A user signed in on multiple devices keeps one active token per device.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["deviceToken"],
                  properties: {
                    deviceToken: {
                      type: "string",
                      description: "Current FCM registration token for this device.",
                    },
                    devicePlatform: {
                      type: "string",
                      enum: ["android", "ios"],
                      description: "Device platform (defaults to android).",
                    },
                    appVersion: {
                      type: "string",
                      description: "Optional app version string for diagnostics.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Device token registered/refreshed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok"],
                    properties: {
                      ok: { type: "boolean", example: true },
                      registered: { type: "boolean", example: true },
                    },
                  },
                },
              },
            },
            400: {
              description: "Missing or invalid deviceToken",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/mobile/app-settings": {
        get: {
          tags: ["Mobile App Settings"],
          summary: "Resolve force-update, cache flags, and redirect link for a mobile app version",
          description:
            "Evaluates the incoming device type and integer app version code against dashboard-managed mobile app settings. Also returns `fontsVersion` — the current font catalog version; cache the `/api/mobile/fonts` list locally and only re-fetch it when this value changes.",
          parameters: [
            reusableParameters.appSettingsDeviceType,
            reusableParameters.appSettingsAppVersion,
          ],
          responses: {
            200: {
              description: "Resolved mobile app settings decision",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileAppSettingsResponse",
                  },
                },
              },
            },
            400: {
              description: "Missing or invalid deviceType/appVersion",
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
      "/api/mobile/templates/search": {
        get: {
          tags: ["Mobile Templates"],
          summary: "Search published templates",
          description:
            "Returns the same paginated, grouped template payload as /api/mobile/templates. The `query` parameter performs a case-insensitive partial search across template names and tags.",
          parameters: [
            ...localeHeaderParameters,
            ...localeQueryParameters,
            reusableParameters.categoryId,
            reusableParameters.subCategoryId,
            reusableParameters.query,
            reusableParameters.templatesPage,
            reusableParameters.templatesPageSize,
          ],
          responses: {
            200: {
              description: "Published templates search response",
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
            "Accepts a single PNG or JPEG upload and returns a transparent PNG. This route uses the local rembg runtime as the primary remover and automatically falls back to the legacy local remover when rembg cannot safely process the image. Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.",
          security: [{ bearerAuth: [] }],
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
            401: {
              description: "Missing or invalid bearer token",
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
      "/api/mobile/media/image-to-layers": {
        post: {
          tags: ["Mobile Media"],
          summary: "Decompose an image into editable layers",
          description:
            "Accepts a single flat image, runs it through the Replicate layered-decomposition model (qwen/qwen-image-layered), persists each resulting RGBA layer, and returns an editable project in the same shape as GET /api/mobile/templates/{id}. Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["image"],
                  properties: {
                    image: {
                      type: "string",
                      format: "binary",
                    },
                    includeText: {
                      type: "boolean",
                      description:
                        "Defaults to true. Set false for movable image layers only (text stays baked into the raster).",
                    },
                    model: {
                      type: "string",
                      description: "Optional model id override.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description:
                "Decomposed editable layers to insert in place of the source layer",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["canvasWidth", "canvasHeight", "sourceWidth", "sourceHeight", "layers", "meta"],
                    properties: {
                      canvasWidth: {
                        type: "number",
                        description:
                          "Width of the coordinate space the layer transforms live in. The client maps this group onto the source layer's region (position, scale, rotation).",
                      },
                      canvasHeight: { type: "number" },
                      sourceWidth: {
                        type: "integer",
                        description: "Original uploaded image width in pixels.",
                      },
                      sourceHeight: { type: "integer" },
                      layers: {
                        type: "array",
                        description:
                          "Decomposed layers ordered bottom→top, in the same format as a template project's `layers`. IMAGE layers carry `imageUri`, `frameWidth`, `frameHeight`, `cropRect`, and `filters`; TEXT layers carry `text`, `fontName`, `size`, `colorHex`, `alignment`, and `isRtl`. Every layer has a center-based `transform` ({x, y, scale, scaleX, scaleY, rotation, flipX, flipY}), `opacity`, `zIndex`, and `animation`. Flip lives on the sign of scaleX/scaleY; `flipX`/`flipY` booleans restate it (flipX === scaleX < 0) — apply one, not both.",
                        items: {
                          type: "object",
                          additionalProperties: true,
                          properties: {
                            id: { type: "string" },
                            type: {
                              type: "string",
                              enum: ["IMAGE", "TEXT"],
                              description: "Layer kind produced by this endpoint.",
                            },
                            zIndex: { type: "integer" },
                            transform: {
                              type: "object",
                              additionalProperties: true,
                              description:
                                "Center-based transform: x, y, scale, scaleX, scaleY, rotation, flipX, flipY. Flip is authoritative on the sign of scaleX/scaleY (negative = mirrored); flipX/flipY are booleans restating that sign (flipX === scaleX < 0). Apply one representation, not both.",
                            },
                            animation: { $ref: "#/components/schemas/MobileLayerAnimation" },
                          },
                        },
                      },
                      meta: {
                        type: "object",
                        properties: {
                          layerCount: { type: "integer" },
                          textBlockCount: {
                            type: "integer",
                            description: "Number of editable text layers extracted via OCR.",
                          },
                          textRemoved: {
                            type: "boolean",
                            description:
                              "Whether baked-in text was inpainted out of the raster layers.",
                          },
                          provider: { type: "string", example: "replicate" },
                          model: { type: "string", example: "qwen/qwen-image-layered" },
                          predictionId: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid multipart payload or empty upload",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
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
              description: "Image could not be processed safely",
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
              description: "Replicate image layering is unavailable",
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
            "Accepts an image plus a same-size binary mask, stages both inputs privately for Replicate, waits for the object-removal model to finish, and returns the edited image directly in the response. Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.",
          security: [{ bearerAuth: [] }],
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
              description: "Missing or invalid bearer token",
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
      "/api/mobile/media/ai-expand": {
        post: {
          tags: ["Mobile Media"],
          summary: "AI expand image canvas",
          description:
            "Accepts an image plus target canvas dimensions, stages the input privately for Replicate, runs the configured AI Expand (outpainting) model, and returns the expanded image directly in the response. Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["image", "targetWidth", "targetHeight"],
                  properties: {
                    image: {
                      type: "string",
                      format: "binary",
                    },
                    targetWidth: {
                      type: "integer",
                      description: "Target canvas width in pixels.",
                    },
                    targetHeight: {
                      type: "integer",
                      description: "Target canvas height in pixels.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Expanded image",
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
              },
            },
            400: {
              description: "Invalid multipart payload, empty upload, or invalid target dimensions",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
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
              description: "Image could not be processed safely",
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
              description: "Replicate AI Expand is unavailable",
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
      "/api/mobile/media/upscale": {
        post: {
          tags: ["Mobile Media"],
          summary: "Upscale / enhance image quality",
          description:
            "Accepts a single PNG or JPEG upload, stages it privately for Replicate, runs the configured AI upscaler model (default Pruna p-image-upscale) at 2x, and returns the higher-resolution image directly in the response. Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["image"],
                  properties: {
                    image: {
                      type: "string",
                      format: "binary",
                    },
                    scale: {
                      type: "integer",
                      enum: [2],
                      default: 2,
                      description: "Upscale factor. Fixed at 2x.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Upscaled image",
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
              },
            },
            400: {
              description: "Invalid multipart payload, empty upload, or invalid scale",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
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
              description: "Image could not be upscaled",
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
              description: "Replicate image upscale is unavailable",
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
      "/api/mobile/media/edit-image": {
        post: {
          tags: ["Mobile Media"],
          summary: "Edit image by prompt",
          description:
            "Accepts a single PNG or JPEG image (max 15 MB) plus a natural-language `prompt` (1–2000 characters) describing the change, stages the input privately for Replicate, runs the selected prompt-based image-editing model, and returns the edited image directly in the response. Optionally pass `model` to choose between the supported editors (default `google/nano-banana`; also `qwen/qwen-image-edit-plus` and `black-forest-labs/flux-kontext-pro`). Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.\n\n**Limits:** PNG/JPEG input only; upload max 15 MB; the source image is downscaled so its longest edge is ≤1536px before editing (output is typically ~1MP — chain the upscale endpoint for higher resolution). `prompt` is required, trimmed, and capped at 2000 characters. Rate limited to 6 requests per 5 minutes per user. Provider safety filters may reject some prompts (returned as 422).\n\n**Processing time:** the request is synchronous. It usually completes in 5–15s but can take up to ~4 minutes during Replicate queue spikes (the server waits up to 240s, then returns 503). Set your client/HTTP request timeout to at least 4 minutes so the connection is not dropped while the edit is still running.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["image", "prompt"],
                  properties: {
                    image: {
                      type: "string",
                      format: "binary",
                      description:
                        "Source image to edit. PNG or JPEG only, max 15 MB. Larger images are downscaled so the longest edge is ≤1536px before editing.",
                    },
                    prompt: {
                      type: "string",
                      minLength: 1,
                      maxLength: 2000,
                      description:
                        "Natural-language instruction describing the edit to apply. Required and trimmed; 1–2000 characters (empty or >2000 chars is rejected with 400).",
                    },
                    model: {
                      type: "string",
                      enum: [
                        "google/nano-banana",
                        "qwen/qwen-image-edit-plus",
                        "black-forest-labs/flux-kontext-pro",
                      ],
                      default: "google/nano-banana",
                      description:
                        "Replicate model to use. Defaults to google/nano-banana when omitted or unrecognized.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Edited image",
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
              description: "Invalid multipart payload, empty upload, or missing prompt",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
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
              description: "Image could not be edited with this prompt",
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
              description: "Replicate image edit is unavailable",
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
            "Returns mobile font catalog merged with custom uploaded fonts and synced source fonts. By default returns the ENTIRE catalog in one response (no pagination) plus a `version` field for local caching — cache the list keyed by `version` and re-fetch only when `fontsVersion` from `/api/mobile/app-settings` changes. Supports search/category/language filtering; pass `pageSize` to paginate instead of returning everything. Each font includes a `previewImage` object with pre-rendered light/dark sample-text PNGs (transparent background); it is `null` until previews are generated in the admin console.",
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
      "/api/mobile/favorites": {
        get: {
          tags: ["Mobile Favorites"],
          summary: "List the signed-in user's favorite templates",
          description:
            "Returns the authenticated mobile user's favorited templates, newest first, each with a lightweight template summary. Requires a logged-in mobile user: send the access token from the social login flow as `Authorization: Bearer <token>`.",
          security: [{ bearerAuth: [] }],
          parameters: [
            reusableParameters.templatesPage,
            reusableParameters.favoritesPageSize,
          ],
          responses: {
            200: {
              description: "Paginated list of favorites",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoritesListResponse",
                  },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
        post: {
          tags: ["Mobile Favorites"],
          summary: "Add a template to favorites",
          description:
            "Saves a template id to the signed-in user's favorites. Idempotent: re-favoriting an already-favorited template returns the existing favorite with `created: false`. Only published templates can be favorited. Requires a logged-in mobile user.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["templateId"],
                  properties: {
                    templateId: {
                      type: "string",
                      format: "uuid",
                      description: "UUID of the template to favorite.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Template was already in favorites",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoriteMutationResponse",
                  },
                },
              },
            },
            201: {
              description: "Favorite created",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoriteMutationResponse",
                  },
                },
              },
            },
            400: {
              description: "Missing or invalid templateId",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            404: {
              description: "Template not found or not published",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/mobile/favorites/{templateId}": {
        get: {
          tags: ["Mobile Favorites"],
          summary: "Check whether a template is favorited",
          description:
            "Returns whether the given template is in the signed-in user's favorites. Always 200 with an `isFavorite` flag. Requires a logged-in mobile user.",
          security: [{ bearerAuth: [] }],
          parameters: [reusableParameters.favoriteTemplateIdPath],
          responses: {
            200: {
              description: "Favorite status for the template",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoriteStatusResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid templateId",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
        put: {
          tags: ["Mobile Favorites"],
          summary: "Ensure a template is favorited (idempotent upsert)",
          description:
            "Adds the template (addressed by URL) to the signed-in user's favorites if not already present. Validates that the template exists and is published. Requires a logged-in mobile user.",
          security: [{ bearerAuth: [] }],
          parameters: [reusableParameters.favoriteTemplateIdPath],
          responses: {
            200: {
              description: "Template was already in favorites",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoriteMutationResponse",
                  },
                },
              },
            },
            201: {
              description: "Favorite created",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoriteMutationResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid templateId",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            404: {
              description: "Template not found or not published",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
        delete: {
          tags: ["Mobile Favorites"],
          summary: "Remove a template from favorites",
          description:
            "Removes the template from the signed-in user's favorites. Idempotent: `removed` is false when the template was not favorited. Requires a logged-in mobile user.",
          security: [{ bearerAuth: [] }],
          parameters: [reusableParameters.favoriteTemplateIdPath],
          responses: {
            200: {
              description: "Favorite removed (or was not present)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MobileFavoriteDeleteResponse",
                  },
                },
              },
            },
            400: {
              description: "Invalid templateId",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            401: {
              description: "Missing or invalid bearer token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas,
    },
  };
}
