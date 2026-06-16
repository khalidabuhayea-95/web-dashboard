export class EditImageError extends Error {
  code: string;
  statusCode: number;
  expose: boolean;
  transient: boolean;
  details: unknown;

  constructor(
    message: string,
    {
      code = "EDIT_IMAGE_ERROR",
      statusCode = 500,
      expose = true,
      transient = false,
      details = null,
    }: {
      code?: string;
      statusCode?: number;
      expose?: boolean;
      transient?: boolean;
      details?: unknown;
    } = {}
  ) {
    super(String(message || "Image edit failed."));
    this.name = "EditImageError";
    this.code = code;
    this.statusCode = Number(statusCode) || 500;
    this.expose = expose !== false;
    this.transient = transient === true;
    this.details = details;
  }
}

export function isEditImageError(error: unknown): error is EditImageError {
  return error instanceof EditImageError;
}

export function createInvalidInputError(message = "Invalid image edit input.") {
  return new EditImageError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
  });
}

export function createInvalidPromptError(message = "A text prompt describing the edit is required.") {
  return new EditImageError(message, {
    code: "INVALID_PROMPT",
    statusCode: 400,
  });
}

export function createUnsupportedImageTypeError(message = "Unsupported image type.") {
  return new EditImageError(message, {
    code: "UNSUPPORTED_IMAGE_TYPE",
    statusCode: 415,
  });
}

export function createFileTooLargeError(message = "Image file is too large.") {
  return new EditImageError(message, {
    code: "FILE_TOO_LARGE",
    statusCode: 413,
  });
}

export function createUnauthorizedError(message = "Unauthorized.") {
  return new EditImageError(message, {
    code: "UNAUTHORIZED",
    statusCode: 401,
  });
}

export function createForbiddenError(message = "Forbidden.") {
  return new EditImageError(message, {
    code: "FORBIDDEN",
    statusCode: 403,
  });
}

export function createNotFoundError(message = "Image edit job not found.") {
  return new EditImageError(message, {
    code: "NOT_FOUND",
    statusCode: 404,
  });
}

export function createProviderUnavailableError(message = "Image edit service is unavailable.") {
  return new EditImageError(message, {
    code: "PROVIDER_UNAVAILABLE",
    statusCode: 503,
    transient: true,
  });
}

export function createUnprocessableImageError(message = "Could not edit the image with this prompt.") {
  return new EditImageError(message, {
    code: "UNPROCESSABLE_IMAGE",
    statusCode: 422,
  });
}

export function createProcessingFailedError(
  message = "Failed to edit the image.",
  options: { transient?: boolean; details?: unknown } = {}
) {
  return new EditImageError(message, {
    code: "PROCESSING_FAILED",
    statusCode: 500,
    transient: options.transient === true,
    details: options.details ?? null,
  });
}
