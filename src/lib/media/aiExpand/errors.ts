export class AiExpandError extends Error {
  code: string;
  statusCode: number;
  expose: boolean;
  transient: boolean;
  details: unknown;

  constructor(
    message: string,
    {
      code = "AI_EXPAND_ERROR",
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
    super(String(message || "AI Expand failed."));
    this.name = "AiExpandError";
    this.code = code;
    this.statusCode = Number(statusCode) || 500;
    this.expose = expose !== false;
    this.transient = transient === true;
    this.details = details;
  }
}

export function isAiExpandError(error: unknown): error is AiExpandError {
  return error instanceof AiExpandError;
}

export function createInvalidInputError(message = "Invalid AI Expand input.") {
  return new AiExpandError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
  });
}

export function createUnsupportedImageTypeError(message = "Unsupported image type.") {
  return new AiExpandError(message, {
    code: "UNSUPPORTED_IMAGE_TYPE",
    statusCode: 415,
  });
}

export function createFileTooLargeError(message = "Image file is too large.") {
  return new AiExpandError(message, {
    code: "FILE_TOO_LARGE",
    statusCode: 413,
  });
}

export function createProviderUnavailableError(message = "AI Expand service is unavailable.") {
  return new AiExpandError(message, {
    code: "PROVIDER_UNAVAILABLE",
    statusCode: 503,
    transient: true,
  });
}

export function createUnprocessableImageError(message = "Could not expand the selected image.") {
  return new AiExpandError(message, {
    code: "UNPROCESSABLE_IMAGE",
    statusCode: 422,
  });
}

export function createProcessingFailedError(
  message = "Failed to expand the selected image.",
  options: { transient?: boolean; details?: unknown } = {}
) {
  return new AiExpandError(message, {
    code: "PROCESSING_FAILED",
    statusCode: 500,
    transient: options.transient === true,
    details: options.details ?? null,
  });
}
