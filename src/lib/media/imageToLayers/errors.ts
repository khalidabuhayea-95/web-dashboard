export class ImageToLayersError extends Error {
  code: string;
  statusCode: number;
  expose: boolean;
  transient: boolean;
  details: unknown;

  constructor(
    message: string,
    {
      code = "IMAGE_TO_LAYERS_ERROR",
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
    super(String(message || "Image layering failed."));
    this.name = "ImageToLayersError";
    this.code = code;
    this.statusCode = Number(statusCode) || 500;
    this.expose = expose !== false;
    this.transient = transient === true;
    this.details = details;
  }
}

export function isImageToLayersError(error: unknown): error is ImageToLayersError {
  return error instanceof ImageToLayersError;
}

export function createInvalidInputError(message = "Invalid image input.") {
  return new ImageToLayersError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
  });
}

export function createUnsupportedImageTypeError(message = "Unsupported image type.") {
  return new ImageToLayersError(message, {
    code: "UNSUPPORTED_IMAGE_TYPE",
    statusCode: 415,
  });
}

export function createFileTooLargeError(message = "Image file is too large.") {
  return new ImageToLayersError(message, {
    code: "FILE_TOO_LARGE",
    statusCode: 413,
  });
}

export function createUnauthorizedError(message = "Unauthorized.") {
  return new ImageToLayersError(message, {
    code: "UNAUTHORIZED",
    statusCode: 401,
  });
}

export function createForbiddenError(message = "Forbidden.") {
  return new ImageToLayersError(message, {
    code: "FORBIDDEN",
    statusCode: 403,
  });
}

export function createProviderUnavailableError(message = "Image layering service is unavailable.") {
  return new ImageToLayersError(message, {
    code: "PROVIDER_UNAVAILABLE",
    statusCode: 503,
    transient: true,
  });
}

export function createUnprocessableImageError(message = "Could not decompose the uploaded image.") {
  return new ImageToLayersError(message, {
    code: "UNPROCESSABLE_IMAGE",
    statusCode: 422,
  });
}

export function createProcessingFailedError(
  message = "Failed to decompose the image into layers.",
  options: { transient?: boolean; details?: unknown } = {}
) {
  return new ImageToLayersError(message, {
    code: "PROCESSING_FAILED",
    statusCode: 500,
    transient: options.transient === true,
    details: options.details ?? null,
  });
}
