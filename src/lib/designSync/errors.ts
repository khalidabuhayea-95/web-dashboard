/**
 * A refusal the app is expected to act on. `code` is the contract (the app switches on it, never on
 * the message); `extra` rides in the JSON body beside it.
 */
export class DesignSyncError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "DesignSyncError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const DesignSyncCodes = {
  QUOTA_EXCEEDED: "storage_quota_exceeded",
  CONFLICT: "content_conflict",
  MEDIA_MISSING: "media_missing",
  PURGED: "design_purged",
  NOT_FOUND: "design_not_found",
  TOO_LARGE: "design_too_large",
  FILE_TOO_LARGE: "file_too_large",
  NON_PORTABLE: "non_portable_uri",
  FOLDER_DELETED: "folder_deleted",
  INVALID: "invalid_request",
} as const;
