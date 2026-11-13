// The design-sync part of the mobile OpenAPI spec. Kept beside the code it documents and spread
// into buildMobileOpenApiSpec (src/lib/mobile/openapi.js) — the coverage check walks the route
// files and fails `npm run lint` if any of them is missing from here.

export const DESIGN_SYNC_TAG = "Mobile Design Sync";

const ERROR = { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } };
const json = (ref) => ({ "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } });
const UNAUTHORIZED = { description: "Missing or invalid bearer token", content: ERROR };
const RATE_LIMITED = { description: "Rate limit exceeded", content: ERROR };
const security = [{ bearerAuth: [] }];

const designIdParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "The app's own design id (e.g. `project-<uuid>`). Unique per user.",
  schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$" },
};

const folderIdParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "The app's own folder id (e.g. `folder-<uuid>`). Unique per user.",
  schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$" },
};

const mutationIdQuery = {
  name: "mutationId",
  in: "query",
  required: false,
  description: "The device's id for this write, so a retry is recognised.",
  schema: { type: "string" },
};

export const designSyncOpenApiSchemas = {
  DesignSyncStorage: {
    type: "object",
    required: ["usedBytes", "limitBytes", "tier"],
    properties: {
      usedBytes: {
        type: "integer",
        format: "int64",
        description:
          "Every media file the user holds (pending uploads included) plus the JSON of every design that is not purged. The Trash counts until it is purged.",
      },
      limitBytes: { type: "integer", format: "int64", description: "The user's tier limit (dashboard-editable)." },
      tier: { type: "string", enum: ["free", "plus", "pro"] },
    },
  },
  DesignSyncDesignHeader: {
    type: "object",
    required: ["id", "name", "revision", "changeSeq", "schemaVersion", "contentHash", "purged"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      revision: { type: "integer", description: "Bumped by every accepted write (content or header)." },
      changeSeq: { type: "integer", format: "int64", description: "Position in the user's change log." },
      schemaVersion: { type: "integer", description: "Version of the document format the app wrote." },
      contentHash: {
        type: "string",
        description: "SHA-256 (hex) of the document as the app sent it; empty for a purged design.",
      },
      clientCreatedAt: { type: "integer", format: "int64", description: "Device epoch ms — display only." },
      clientUpdatedAt: { type: "integer", format: "int64", description: "Device epoch ms — display only." },
      folderId: { type: "string", nullable: true },
      deletedAt: {
        type: "integer",
        format: "int64",
        nullable: true,
        description: "Device epoch ms it was moved to the Trash; null when live. The server purges 30 days after IT first saw the design trashed.",
      },
      purged: { type: "boolean", description: "True = a tombstone: the design is gone for good." },
      jsonBytes: { type: "integer" },
      thumbnailSha256: {
        type: "string",
        nullable: true,
        description: "The preview the device rendered with the current document (an uploaded media file), or null.",
      },
      thumbnailUrl: {
        type: "string",
        nullable: true,
        description: "Short-lived (6 h) link to that preview, so a new device can list the library before downloading any design.",
      },
    },
  },
  DesignSyncFolder: {
    type: "object",
    required: ["id", "name", "colorKey", "revision", "changeSeq", "deleted"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      colorKey: { type: "string", description: "The app's colour key: teal, coral, amber, violet, green, slate." },
      revision: { type: "integer" },
      changeSeq: { type: "integer", format: "int64" },
      clientCreatedAt: { type: "integer", format: "int64" },
      clientUpdatedAt: { type: "integer", format: "int64" },
      deleted: { type: "boolean", description: "True = a tombstone: the folder was deleted (its designs stay)." },
    },
  },
  DesignSyncFont: {
    type: "object",
    required: ["id", "fontName", "displayName", "sha256", "sizeBytes", "revision", "changeSeq", "deleted"],
    properties: {
      id: { type: "string", description: "`font-<sha256 of the file>`: the same file on two devices is one font." },
      fontName: { type: "string", description: "The name designs use for this font — install it under exactly this name." },
      displayName: { type: "string" },
      sha256: { type: "string" },
      sizeBytes: { type: "integer", format: "int64" },
      revision: { type: "integer" },
      changeSeq: { type: "integer", format: "int64" },
      deleted: { type: "boolean", description: "True = removed from the account." },
      downloadUrl: { type: "string", nullable: true, description: "Signed link to the font file (24 h); null when deleted." },
    },
  },
  DesignSyncFontWriteRequest: {
    type: "object",
    required: ["mutationId", "fontName", "sha256"],
    properties: {
      mutationId: { type: "string" },
      fontName: { type: "string" },
      displayName: { type: "string" },
      sha256: { type: "string", description: "Must match the id, and the file must already be uploaded (ready)." },
    },
  },
  DesignSyncFontResponse: {
    type: "object",
    properties: { font: { allOf: [{ $ref: "#/components/schemas/DesignSyncFont" }], nullable: true } },
  },
  DesignSyncPartsRequest: {
    type: "object",
    required: ["sha256"],
    properties: { sha256: { type: "string" } },
  },
  DesignSyncPartsResponse: {
    type: "object",
    required: ["sha256", "partBytes", "partCount", "uploadedParts", "parts"],
    properties: {
      sha256: { type: "string" },
      partBytes: { type: "integer", description: "Size of every part but the last." },
      partCount: { type: "integer" },
      uploadedParts: { type: "array", items: { type: "integer" }, description: "Parts storage already holds — do not send again." },
      parts: {
        type: "array",
        description: "The missing parts: PUT exactly `sizeBytes` bytes of the file, from offset (partNumber−1)·partBytes, to `uploadUrl` (Content-Length is signed).",
        items: {
          type: "object",
          required: ["partNumber", "sizeBytes", "uploadUrl"],
          properties: {
            partNumber: { type: "integer" },
            sizeBytes: { type: "integer", format: "int64" },
            uploadUrl: { type: "string" },
          },
        },
      },
    },
  },
  DesignSyncChangesResponse: {
    type: "object",
    required: ["designs", "folders", "fonts", "cursor", "hasMore", "storage", "reset"],
    properties: {
      designs: { type: "array", items: { $ref: "#/components/schemas/DesignSyncDesignHeader" } },
      folders: { type: "array", items: { $ref: "#/components/schemas/DesignSyncFolder" } },
      fonts: { type: "array", items: { $ref: "#/components/schemas/DesignSyncFont" } },
      cursor: { type: "integer", format: "int64", description: "Send back as `since` to continue." },
      hasMore: { type: "boolean" },
      storage: { $ref: "#/components/schemas/DesignSyncStorage" },
      reset: {
        type: "boolean",
        description:
          "True when `since` is beyond anything the library ever numbered (its history started over, e.g. a restored database). The device must forget what it believes the server holds, pull from `cursor`, and offer its designs again.",
      },
    },
  },
  DesignSyncMediaFile: {
    type: "object",
    required: ["sha256", "sizeBytes", "contentType", "url"],
    properties: {
      sha256: { type: "string" },
      sizeBytes: { type: "integer", format: "int64" },
      contentType: { type: "string" },
      url: { type: "string", description: "Signed download URL, valid for about an hour." },
    },
  },
  DesignSyncDesignResponse: {
    type: "object",
    required: ["design", "data", "media"],
    properties: {
      design: { $ref: "#/components/schemas/DesignSyncDesignHeader" },
      data: {
        type: "string",
        description:
          "The app's DesignProject JSON as a STRING, byte for byte what was pushed (its SHA-256 is `design.contentHash`). Portable form: a file from the device appears as `nayroz-cloud-media:///<sha256>.<ext>`; catalog media is an https URL or a relative `/api/storage/public/…` path.",
      },
      media: { type: "array", items: { $ref: "#/components/schemas/DesignSyncMediaFile" } },
    },
  },
  DesignSyncWriteRequest: {
    type: "object",
    required: ["mutationId"],
    properties: {
      mutationId: { type: "string", description: "The device's id for this write; reuse it on every retry." },
      name: { type: "string" },
      clientCreatedAt: { type: "integer", format: "int64" },
      clientUpdatedAt: { type: "integer", format: "int64" },
      folderId: { type: "string", nullable: true, description: "Omit to leave unchanged; null = no folder." },
      deletedAt: {
        type: "integer",
        format: "int64",
        nullable: true,
        description: "Omit to leave unchanged; epoch ms = move to Trash; null = restore.",
      },
      schemaVersion: { type: "integer" },
      contentHash: {
        type: "string",
        description: "SHA-256 (hex) of the UTF-8 bytes of `data`. Required with `data`; the server verifies it.",
      },
      baseContentHash: {
        type: "string",
        nullable: true,
        description: "The contentHash of the document this edit started from; null for a new design.",
      },
      thumbnailSha256: {
        type: "string",
        nullable: true,
        description:
          "An uploaded preview of THIS document (prepared and completed like any media). Only with `data`; omitted or null = no preview. Counted in storage and replaced with the next document.",
      },
      data: {
        type: "string",
        description:
          "The whole document in portable form, as a JSON STRING (not a nested object): it is stored and returned verbatim, so it never loses key order or integer precision. Omit for a header-only write.",
      },
    },
  },
  DesignSyncWriteResponse: {
    type: "object",
    required: ["design", "storage"],
    properties: {
      design: { $ref: "#/components/schemas/DesignSyncDesignHeader" },
      storage: { $ref: "#/components/schemas/DesignSyncStorage" },
    },
  },
  DesignSyncRefusal: {
    type: "object",
    required: ["error", "code"],
    properties: {
      error: { type: "string" },
      code: {
        type: "string",
        description: "What the app switches on.",
        enum: [
          "storage_quota_exceeded",
          "content_conflict",
          "media_missing",
          "design_purged",
          "design_not_found",
          "design_too_large",
          "file_too_large",
          "non_portable_uri",
          "folder_deleted",
          "invalid_request",
        ],
      },
      design: { $ref: "#/components/schemas/DesignSyncDesignHeader" },
      folder: { $ref: "#/components/schemas/DesignSyncFolder" },
      storage: { $ref: "#/components/schemas/DesignSyncStorage" },
      sha256s: { type: "array", items: { type: "string" }, description: "With `media_missing`." },
      neededBytes: { type: "integer", format: "int64", description: "With `storage_quota_exceeded`." },
    },
  },
  DesignSyncPrepareRequest: {
    type: "object",
    required: ["files"],
    properties: {
      files: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          required: ["sha256", "sizeBytes", "contentType"],
          properties: {
            sha256: { type: "string", description: "SHA-256 (hex, lowercase) of the file's bytes." },
            sizeBytes: { type: "integer", format: "int64" },
            contentType: { type: "string" },
          },
        },
      },
    },
  },
  DesignSyncPrepareResponse: {
    type: "object",
    required: ["files", "storage"],
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          required: ["sha256", "status", "sizeBytes", "contentType"],
          properties: {
            sha256: { type: "string" },
            status: {
              type: "string",
              enum: ["ready", "upload", "multipart"],
              description: "`ready` = already stored, skip. `multipart` = over 32 MB: upload in parts via `media/parts`.",
            },
            partBytes: { type: "integer", description: "With `multipart`." },
            partCount: { type: "integer", description: "With `multipart`." },
            sizeBytes: { type: "integer", format: "int64" },
            contentType: { type: "string" },
            uploadUrl: {
              type: "string",
              description:
                "With `upload`: PUT the file here with exactly this Content-Type and Content-Length — both are signed, any other body is rejected by storage.",
            },
          },
        },
      },
      storage: { $ref: "#/components/schemas/DesignSyncStorage" },
    },
  },
  DesignSyncCompleteRequest: {
    type: "object",
    required: ["sha256s"],
    properties: { sha256s: { type: "array", maxItems: 200, items: { type: "string" } } },
  },
  DesignSyncCompleteResponse: {
    type: "object",
    required: ["files"],
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          required: ["sha256", "status"],
          properties: {
            sha256: { type: "string" },
            status: { type: "string", enum: ["ready", "missing", "size_mismatch"] },
          },
        },
      },
    },
  },
  DesignSyncFolderWriteRequest: {
    type: "object",
    required: ["mutationId", "name", "colorKey"],
    properties: {
      mutationId: { type: "string" },
      name: { type: "string" },
      colorKey: { type: "string" },
      clientCreatedAt: { type: "integer", format: "int64" },
      clientUpdatedAt: { type: "integer", format: "int64" },
      revive: {
        type: "boolean",
        description: "True only when the device is undoing its own delete of this folder.",
      },
    },
  },
  DesignSyncFolderResponse: {
    type: "object",
    required: ["folder"],
    properties: { folder: { $ref: "#/components/schemas/DesignSyncFolder", nullable: true } },
  },
  DesignSyncPurgeResponse: {
    type: "object",
    required: ["storage"],
    properties: {
      design: { $ref: "#/components/schemas/DesignSyncDesignHeader", nullable: true },
      storage: { $ref: "#/components/schemas/DesignSyncStorage" },
    },
  },
  DesignSyncStorageResponse: {
    type: "object",
    required: ["storage"],
    properties: { storage: { $ref: "#/components/schemas/DesignSyncStorage" } },
  },
};

export const designSyncOpenApiPaths = {
  "/api/mobile/designs/changes": {
    get: {
      tags: [DESIGN_SYNC_TAG],
      summary: "What changed in the user's design library",
      description:
        "Design headers (tombstones for deleted designs included) and folders that changed after `since`, oldest change first, plus storage usage. Documents are not included — fetch a design whose `contentHash` the device does not have. Ordering uses the server's own per-user change sequence; no device clock is involved. Also the moment the server purges this user's Trash entries older than 30 days.",
      security,
      parameters: [
        { name: "since", in: "query", required: false, description: "Cursor from a previous call; 0 or omitted for a first sync.", schema: { type: "integer", format: "int64", minimum: 0 } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 200 } },
      ],
      responses: {
        200: { description: "A page of changes", content: json("DesignSyncChangesResponse") },
        401: UNAUTHORIZED,
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/{id}": {
    get: {
      tags: [DESIGN_SYNC_TAG],
      summary: "One design with its document and media",
      description: "The header, the portable document, and a signed download URL for every file it references.",
      security,
      parameters: [designIdParameter],
      responses: {
        200: { description: "The design", content: json("DesignSyncDesignResponse") },
        401: UNAUTHORIZED,
        404: { description: "`design_not_found`", content: json("DesignSyncRefusal") },
        410: { description: "`design_purged` — deleted for good", content: json("DesignSyncRefusal") },
        429: RATE_LIMITED,
      },
    },
    put: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Create or update a design",
      description:
        "With `data`: writes the whole document. Every file it references must already be uploaded (`media/prepare` → PUT → `media/complete`), or the write is refused with `media_missing`. Without `data`: updates only the header (name, Trash, folder).\n\n**Conflicts** are decided on content, never on clocks: if the server's document is neither the one being written nor the one this edit started from (`baseContentHash`), the answer is 409 `content_conflict` with the server's header — the device keeps both versions. Header fields are last-writer-wins and never conflict. A retry carrying the same `mutationId` answers the current state.\n\n**Quota** is enforced only when a NEW design is created (and when files are prepared): updates, renames, Trash moves and deletes always go through, so a full or downgraded account can still tidy up.",
      security,
      parameters: [designIdParameter],
      requestBody: { required: true, content: json("DesignSyncWriteRequest") },
      responses: {
        200: { description: "Saved (or already saved — a replay)", content: json("DesignSyncWriteResponse") },
        400: { description: "`invalid_request`", content: json("DesignSyncRefusal") },
        401: UNAUTHORIZED,
        404: { description: "`design_not_found` — a header-only write for a design the server never held", content: json("DesignSyncRefusal") },
        409: { description: "`content_conflict` or `storage_quota_exceeded`", content: json("DesignSyncRefusal") },
        410: { description: "`design_purged`", content: json("DesignSyncRefusal") },
        413: { description: "`design_too_large`", content: json("DesignSyncRefusal") },
        422: { description: "`media_missing` or `non_portable_uri`", content: json("DesignSyncRefusal") },
        429: RATE_LIMITED,
      },
    },
    delete: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Delete a design for good",
      description:
        "Removes the document and frees the files only it used; the row stays as a tombstone so other devices learn of it. Idempotent: an unknown or already-purged design answers 200.",
      security,
      parameters: [designIdParameter, mutationIdQuery],
      responses: {
        200: { description: "Purged", content: json("DesignSyncPurgeResponse") },
        401: UNAUTHORIZED,
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/media/prepare": {
    post: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Ask which files to upload",
      description:
        "The files a design needs, by content hash. For each one the server lacks it reserves the space and returns a signed URL the device PUTs the file to directly (the bytes never pass through this API). All-or-nothing: if the missing files do not fit the user's storage, nothing is reserved and the answer is 409 `storage_quota_exceeded`.",
      security,
      requestBody: { required: true, content: json("DesignSyncPrepareRequest") },
      responses: {
        200: { description: "Per-file status and upload URLs", content: json("DesignSyncPrepareResponse") },
        400: { description: "`invalid_request`", content: json("DesignSyncRefusal") },
        401: UNAUTHORIZED,
        409: { description: "`storage_quota_exceeded`", content: json("DesignSyncRefusal") },
        413: { description: "`file_too_large`", content: json("DesignSyncRefusal") },
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/media/complete": {
    post: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Confirm uploaded files",
      description:
        "The server checks each file in storage and marks it ready only if it is there at the reserved size. A design can be written once all its files are ready.",
      security,
      requestBody: { required: true, content: json("DesignSyncCompleteRequest") },
      responses: {
        200: { description: "Per-file outcome", content: json("DesignSyncCompleteResponse") },
        400: { description: "`invalid_request`", content: json("DesignSyncRefusal") },
        401: UNAUTHORIZED,
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/media/parts": {
    post: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Parts of a large file to upload",
      description:
        "For a file `prepare` answered `multipart`: the parts storage already holds and a signed URL for each missing one. Call again after any interruption — the upload resumes from what storage has. When every part is up, `media/complete` joins them.",
      security,
      requestBody: { required: true, content: json("DesignSyncPartsRequest") },
      responses: {
        200: { description: "Uploaded and missing parts", content: json("DesignSyncPartsResponse") },
        400: { description: "`invalid_request`", content: json("DesignSyncRefusal") },
        401: UNAUTHORIZED,
        404: { description: "`media_missing`: prepare the file first", content: json("DesignSyncRefusal") },
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/fonts/{id}": {
    put: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Add an installed font to the account",
      description: "The font file must be uploaded first (prepare → PUT → complete). Idempotent; brings back a deleted font.",
      security,
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: json("DesignSyncFontWriteRequest") },
      responses: {
        200: { description: "Saved", content: json("DesignSyncFontResponse") },
        400: { description: "`invalid_request`", content: json("DesignSyncRefusal") },
        401: UNAUTHORIZED,
        422: { description: "`media_missing`", content: json("DesignSyncRefusal") },
        429: RATE_LIMITED,
      },
    },
    delete: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Remove a font from the account",
      description: "Every device learns of it through `changes`. Idempotent.",
      security,
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, mutationIdQuery],
      responses: {
        200: { description: "Removed", content: json("DesignSyncFontResponse") },
        401: UNAUTHORIZED,
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/folders/{id}": {
    put: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Create or update a folder",
      description:
        "Name and colour, last writer wins. A folder deleted on another device answers 410 `folder_deleted` unless `revive` is true (the deleting device undoing its own delete).",
      security,
      parameters: [folderIdParameter],
      requestBody: { required: true, content: json("DesignSyncFolderWriteRequest") },
      responses: {
        200: { description: "Saved", content: json("DesignSyncFolderResponse") },
        400: { description: "`invalid_request`", content: json("DesignSyncRefusal") },
        401: UNAUTHORIZED,
        410: { description: "`folder_deleted`", content: json("DesignSyncRefusal") },
        429: RATE_LIMITED,
      },
    },
    delete: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Delete a folder",
      description: "Only the folder: its designs stay, in no folder. Idempotent.",
      security,
      parameters: [folderIdParameter, mutationIdQuery],
      responses: {
        200: { description: "Deleted", content: json("DesignSyncFolderResponse") },
        401: UNAUTHORIZED,
        429: RATE_LIMITED,
      },
    },
  },
  "/api/mobile/designs/storage": {
    get: {
      tags: [DESIGN_SYNC_TAG],
      summary: "Cloud storage usage",
      description: "How much the signed-in user is using, and their tier's limit.",
      security,
      responses: {
        200: { description: "Usage and limit", content: json("DesignSyncStorageResponse") },
        401: UNAUTHORIZED,
        429: RATE_LIMITED,
      },
    },
  },
};
