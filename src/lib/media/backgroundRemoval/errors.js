export class BackgroundRemovalError extends Error {
  constructor(
    message,
    {
      code = "BACKGROUND_REMOVAL_ERROR",
      statusCode = 500,
      expose = true,
      details = null,
    } = {}
  ) {
    super(String(message || "Background removal failed."));
    this.name = "BackgroundRemovalError";
    this.code = code;
    this.statusCode = Number(statusCode) || 500;
    this.expose = expose !== false;
    this.details = details;
  }
}

export function isBackgroundRemovalError(error) {
  return error instanceof BackgroundRemovalError;
}

export function createInvalidInputError(message = "Invalid background removal input.") {
  return new BackgroundRemovalError(message, {
    code: "INVALID_INPUT",
    statusCode: 400,
  });
}

export function createUnsupportedImageTypeError(message = "Unsupported image type.") {
  return new BackgroundRemovalError(message, {
    code: "UNSUPPORTED_IMAGE_TYPE",
    statusCode: 415,
  });
}

export function createFileTooLargeError(message = "Image file is too large.") {
  return new BackgroundRemovalError(message, {
    code: "FILE_TOO_LARGE",
    statusCode: 413,
  });
}

export function createProviderUnavailableError(message = "Background removal service is unavailable.") {
  return new BackgroundRemovalError(message, {
    code: "PROVIDER_UNAVAILABLE",
    statusCode: 503,
  });
}

export function createUnprocessableImageError(message = "Could not isolate the image background.") {
  return new BackgroundRemovalError(message, {
    code: "UNPROCESSABLE_IMAGE",
    statusCode: 422,
  });
}

export function createProcessingFailedError(message = "Failed to remove image background.") {
  return new BackgroundRemovalError(message, {
    code: "PROCESSING_FAILED",
    statusCode: 500,
  });
}
