export class ImageUpscaleError extends Error {
  code: string;
  statusCode: number;
  expose: boolean;
  transient: boolean;
  details: unknown;

  constructor(
    message: string,
    {
      code = "IMAGE_UPSCALE_ERROR",
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
    super(String(message || "Image upscale failed."));
    this.name = "ImageUpscaleError";
    this.code = code;
    this.statusCode = Number(statusCode) || 500;
    this.expose = expose !== false;
    this.transient = transient === true;
    this.details = details;
  }
}

export function isImageUpscaleError(error: unknown): error is ImageUpscaleError {
  return error instanceof ImageUpscaleError;
}

export function createInvalidInputError(message = "Invalid image upscale input.") {
  return new ImageUpscaleError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
  });
}

export function createUnsupportedImageTypeError(message = "Unsupported image type.") {
  return new ImageUpscaleError(message, {
    code: "UNSUPPORTED_IMAGE_TYPE",
    statusCode: 415,
  });
}

export function createFileTooLargeError(message = "Image file is too large.") {
  return new ImageUpscaleError(message, {
    code: "FILE_TOO_LARGE",
    statusCode: 413,
  });
}

export function createProviderUnavailableError(message = "Image upscale service is unavailable.") {
  return new ImageUpscaleError(message, {
    code: "PROVIDER_UNAVAILABLE",
    statusCode: 503,
    transient: true,
  });
}

export function createUnprocessableImageError(message = "Could not upscale the selected image.") {
  return new ImageUpscaleError(message, {
    code: "UNPROCESSABLE_IMAGE",
    statusCode: 422,
  });
}

export function createProcessingFailedError(
  message = "Failed to upscale the selected image.",
  options: { transient?: boolean; details?: unknown } = {}
) {
  return new ImageUpscaleError(message, {
    code: "PROCESSING_FAILED",
    statusCode: 500,
    transient: options.transient === true,
    details: options.details ?? null,
  });
}
