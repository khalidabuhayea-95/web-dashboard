export class ObjectRemovalError extends Error {
  code: string;
  statusCode: number;
  expose: boolean;
  transient: boolean;
  details: unknown;

  constructor(
    message: string,
    {
      code = "OBJECT_REMOVAL_ERROR",
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
    super(String(message || "Object removal failed."));
    this.name = "ObjectRemovalError";
    this.code = code;
    this.statusCode = Number(statusCode) || 500;
    this.expose = expose !== false;
    this.transient = transient === true;
    this.details = details;
  }
}

export function isObjectRemovalError(error: unknown): error is ObjectRemovalError {
  return error instanceof ObjectRemovalError;
}

export function createInvalidInputError(message = "Invalid object removal input.") {
  return new ObjectRemovalError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
  });
}

export function createUnsupportedImageTypeError(message = "Unsupported image type.") {
  return new ObjectRemovalError(message, {
    code: "UNSUPPORTED_IMAGE_TYPE",
    statusCode: 415,
  });
}

export function createFileTooLargeError(message = "Image file is too large.") {
  return new ObjectRemovalError(message, {
    code: "FILE_TOO_LARGE",
    statusCode: 413,
  });
}

export function createUnauthorizedError(message = "Unauthorized.") {
  return new ObjectRemovalError(message, {
    code: "UNAUTHORIZED",
    statusCode: 401,
  });
}

export function createForbiddenError(message = "Forbidden.") {
  return new ObjectRemovalError(message, {
    code: "FORBIDDEN",
    statusCode: 403,
  });
}

export function createNotFoundError(message = "Object removal job not found.") {
  return new ObjectRemovalError(message, {
    code: "NOT_FOUND",
    statusCode: 404,
  });
}

export function createProviderUnavailableError(message = "Object removal service is unavailable.") {
  return new ObjectRemovalError(message, {
    code: "PROVIDER_UNAVAILABLE",
    statusCode: 503,
    transient: true,
  });
}

export function createUnprocessableImageError(message = "Could not remove the selected object.") {
  return new ObjectRemovalError(message, {
    code: "UNPROCESSABLE_IMAGE",
    statusCode: 422,
  });
}

export function createProcessingFailedError(
  message = "Failed to remove the selected object.",
  options: { transient?: boolean; details?: unknown } = {}
) {
  return new ObjectRemovalError(message, {
    code: "PROCESSING_FAILED",
    statusCode: 500,
    transient: options.transient === true,
    details: options.details ?? null,
  });
}
