const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LOG_LEVEL = "info";

function readLogLevel() {
  const fromEnv = String(process?.env?.LOG_LEVEL || "").trim().toLowerCase();
  if (LOG_LEVELS[fromEnv]) return fromEnv;
  return DEFAULT_LOG_LEVEL;
}

function shouldLog(level) {
  const configured = LOG_LEVELS[readLogLevel()] || LOG_LEVELS[DEFAULT_LOG_LEVEL];
  const candidate = LOG_LEVELS[level] || LOG_LEVELS.info;
  return candidate >= configured;
}

function cleanContext(context) {
  if (!context || typeof context !== "object") return {};
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  );
}

function serializeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "object") {
    return cleanContext(error);
  }
  return { message: String(error) };
}

function writeLog(level, payload) {
  const printer = console[level] || console.log;
  printer(JSON.stringify(payload));
}

export function createLogger(scope, baseContext = {}) {
  const normalizedScope = String(scope || "app").trim() || "app";
  const staticContext = cleanContext(baseContext);

  function log(level, message, context = {}, error = null) {
    if (!shouldLog(level)) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope: normalizedScope,
      message: String(message || ""),
      ...staticContext,
      ...cleanContext(context),
    };
    const serializedError = serializeError(error);
    if (serializedError) {
      payload.error = serializedError;
    }
    writeLog(level, payload);
  }

  return {
    debug(message, context = {}) {
      log("debug", message, context);
    },
    info(message, context = {}) {
      log("info", message, context);
    },
    warn(message, context = {}, error = null) {
      log("warn", message, context, error);
    },
    error(message, context = {}, error = null) {
      log("error", message, context, error);
    },
    child(extraContext = {}) {
      return createLogger(normalizedScope, {
        ...staticContext,
        ...cleanContext(extraContext),
      });
    },
  };
}

