/* global chrome */
(function initCanvaImporterLogger() {
  if (typeof globalThis.createExtensionLogger === "function") return;

  const STORAGE_KEY = "canva_importer_logs_v1";
  const MAX_LOG_ENTRIES = 250;
  const FLUSH_DEBOUNCE_MS = 250;
  const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const DEFAULT_LEVEL = "info";

  function trimString(value, maxLength = 500) {
    const source = String(value || "");
    if (source.length <= maxLength) return source;
    return `${source.slice(0, maxLength)}...[truncated:${source.length - maxLength}]`;
  }

  function sanitizeValue(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return trimString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: trimString(value.stack || "", 2000),
      };
    }
    if (Array.isArray(value)) {
      if (depth >= 2) return `[Array(${value.length})]`;
      return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
    }
    if (typeof value === "object") {
      if (depth >= 2) return "[Object]";
      const source = value;
      const result = {};
      Object.entries(source)
        .slice(0, 30)
        .forEach(([key, item]) => {
          result[String(key)] = sanitizeValue(item, depth + 1);
        });
      return result;
    }
    return trimString(value);
  }

  function readLogLevel() {
    const level = String(globalThis.CANVA_IMPORTER_LOG_LEVEL || "")
      .trim()
      .toLowerCase();
    if (LEVELS[level]) return level;
    return DEFAULT_LEVEL;
  }

  function shouldLog(level) {
    const configured = LEVELS[readLogLevel()] || LEVELS[DEFAULT_LEVEL];
    const candidate = LEVELS[level] || LEVELS.info;
    return candidate >= configured;
  }

  let pendingEntries = [];
  let flushTimer = 0;

  function flushPendingLogs() {
    flushTimer = 0;
    try {
      if (!chrome?.storage?.local?.get || !chrome?.storage?.local?.set) return;
      if (!pendingEntries.length) return;
      const entries = pendingEntries.splice(0, pendingEntries.length);
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const runtimeGetError = chrome?.runtime?.lastError;
        if (runtimeGetError) return;
        const existing = Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
        const next = [...existing, ...entries].slice(-MAX_LOG_ENTRIES);
        chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {});
      });
    } catch (_error) {
      // Logging must never crash extension execution.
    }
  }

  function persistLog(entry) {
    pendingEntries.push(entry);
    if (flushTimer) return;
    flushTimer = globalThis.setTimeout(flushPendingLogs, FLUSH_DEBOUNCE_MS);
  }

  function readStoredLogs() {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local?.get) {
          resolve([]);
          return;
        }
        chrome.storage.local.get(STORAGE_KEY, (result) => {
          const runtimeError = chrome?.runtime?.lastError;
          if (runtimeError) {
            resolve([]);
            return;
          }
          const logs = Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
          resolve(logs);
        });
      } catch (_error) {
        resolve([]);
      }
    });
  }

  function clearStoredLogs() {
    return new Promise((resolve) => {
      try {
        pendingEntries = [];
        if (flushTimer) {
          globalThis.clearTimeout(flushTimer);
          flushTimer = 0;
        }
        if (!chrome?.storage?.local?.remove) {
          resolve();
          return;
        }
        chrome.storage.local.remove(STORAGE_KEY, () => resolve());
      } catch (_error) {
        resolve();
      }
    });
  }

  function write(level, scope, message, context, error) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope,
      message: trimString(message || ""),
      context: sanitizeValue(context || {}),
      error: sanitizeValue(error || null),
    };
    const printer = console[level] || console.log;
    printer(`[canva-importer:${scope}] ${payload.message}`, payload);
    persistLog(payload);
  }

  function createExtensionLogger(scope, baseContext = {}) {
    const normalizedScope = String(scope || "extension").trim() || "extension";
    const initialContext = sanitizeValue(baseContext) || {};

    function log(level, message, context = {}, error = null) {
      if (!shouldLog(level)) return;
      const mergedContext = {
        ...(typeof initialContext === "object" && initialContext ? initialContext : {}),
        ...(typeof context === "object" && context ? context : {}),
      };
      write(level, normalizedScope, message, mergedContext, error);
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
        return createExtensionLogger(normalizedScope, {
          ...(typeof initialContext === "object" && initialContext ? initialContext : {}),
          ...(typeof extraContext === "object" && extraContext ? extraContext : {}),
        });
      },
    };
  }

  function installExtensionGlobalErrorHandlers(logger, options = {}) {
    const scope = String(options.scope || "extension").trim() || "extension";
    const guardKey = `__canvaImporterGlobalHandlers_${scope}`;
    if (globalThis[guardKey]) return;
    globalThis[guardKey] = true;

    if (typeof globalThis.addEventListener !== "function") return;

    globalThis.addEventListener("error", (event) => {
      logger.error(
        "Unhandled exception",
        {
          scope,
          filename: String(event?.filename || ""),
          line: Number(event?.lineno || 0),
          column: Number(event?.colno || 0),
          message: String(event?.message || ""),
        },
        event?.error || event?.message || null
      );
    });

    globalThis.addEventListener("unhandledrejection", (event) => {
      logger.error(
        "Unhandled promise rejection",
        { scope },
        event?.reason || null
      );
    });
  }

  globalThis.createExtensionLogger = createExtensionLogger;
  globalThis.installExtensionGlobalErrorHandlers = installExtensionGlobalErrorHandlers;
  globalThis.getCanvaImporterLogs = readStoredLogs;
  globalThis.clearCanvaImporterLogs = clearStoredLogs;
})();
