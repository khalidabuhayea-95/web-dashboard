/* global chrome */
const STORAGE_KEY = "canva_import_settings_v1";
const logger =
  typeof globalThis.createExtensionLogger === "function"
    ? globalThis.createExtensionLogger("popup")
    : {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };

if (typeof globalThis.installExtensionGlobalErrorHandlers === "function") {
  globalThis.installExtensionGlobalErrorHandlers(logger, { scope: "popup" });
}

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, type = "") {
  const node = $("status");
  node.textContent = message || "";
  node.className = `status ${type}`.trim();
}

function normalizeDashboardUrl(raw) {
  const value = String(raw || "").trim() || "http://localhost:3000";
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error("Dashboard URL is invalid.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Dashboard URL must start with http:// or https://");
  }
  return parsed.toString().replace(/\/$/, "");
}

function collectSettings() {
  return {
    dashboardUrl: $("dashboardUrl").value.trim(),
    importToken: $("importToken").value.trim(),
    templateName: $("templateName").value.trim(),
    templateSlug: $("templateSlug").value.trim(),
  };
}

function formatPhaseTimings(phaseTimings) {
  const entries = Object.entries(phaseTimings || {})
    .filter((entry) => Number.isFinite(Number(entry[1])) && Number(entry[1]) >= 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (entries.length === 0) return "";
  return entries
    .slice(0, 4)
    .map(([name, value]) => `${name}: ${Math.round(Number(value))}ms`)
    .join(" | ");
}

function applySettings(settings = {}) {
  $("dashboardUrl").value = settings.dashboardUrl || "http://localhost:3000";
  $("importToken").value = settings.importToken || "";
  $("templateName").value = settings.templateName || "";
  $("templateSlug").value = settings.templateSlug || "";
}

async function saveSettings() {
  const settings = collectSettings();
  const normalizedDashboardUrl = normalizeDashboardUrl(settings.dashboardUrl);
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...settings,
      dashboardUrl: normalizedDashboardUrl,
    },
  });
  applySettings({ ...settings, dashboardUrl: normalizedDashboardUrl });
  logger.info("Settings saved", {
    dashboardUrl: normalizedDashboardUrl,
    hasToken: Boolean(settings.importToken),
  });
  return { ...settings, dashboardUrl: normalizedDashboardUrl };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  applySettings(stored?.[STORAGE_KEY] || {});
}

async function importActiveTab() {
  const settings = await saveSettings();
  if (!settings.importToken) {
    throw new Error("Import token is required.");
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id || !activeTab.url) {
    throw new Error("No active tab found.");
  }
  if (!/^https:\/\/www\.canva\.com\//i.test(activeTab.url)) {
    throw new Error("Open a Canva design tab first.");
  }

  logger.info("Starting import from popup", {
    tabId: Number(activeTab.id || 0),
    dashboardUrl: settings.dashboardUrl,
  });

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "IMPORT_ACTIVE_CANVA_TAB",
        tabId: activeTab.id,
        dashboardUrl: settings.dashboardUrl,
        token: settings.importToken,
        name: settings.templateName,
        slug: settings.templateSlug,
        captureMetadata: false,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          logger.error("chrome.runtime.sendMessage failed", {}, runtimeError);
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.ok) {
          logger.warn("Import response indicates failure", {
            error: String(response?.error || ""),
          });
          reject(new Error(response?.error || "Import request failed."));
          return;
        }
        logger.info("Import response succeeded", {
          templateId: String(response?.template?.id || ""),
          importedCustomFonts: Number(response?.importedCustomFonts || 0),
        });
        resolve(response);
      }
    );
  });
}

async function main() {
  logger.info("Popup initialized");
  await loadSettings();

  $("saveButton").addEventListener("click", async () => {
    try {
      await saveSettings();
      setStatus("Settings saved.", "success");
    } catch (error) {
      logger.error("Failed to save settings", {}, error);
      setStatus(error.message || "Failed to save settings.", "error");
    }
  });

  $("importButton").addEventListener("click", async () => {
    const button = $("importButton");
    button.disabled = true;
    setStatus("Importing active Canva tab...");
    try {
      const result = await importActiveTab();
      const template = result.template || {};
      const layerCount = Number(result.layerCount || 0);
      const importedCustomFonts = Number(result.importedCustomFonts || 0);
      const warnings = Array.isArray(result?.warnings)
        ? result.warnings.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const warningSuffix = warnings.length > 0 ? `\nWarnings: ${warnings.join(" | ")}` : "";
      const phaseTimingSummary = formatPhaseTimings(result?.phaseTimings);
      const timingSuffix = phaseTimingSummary ? `\nTimings: ${phaseTimingSummary}` : "";
      const metadataSuffix = result?.captureMetadata ? "\nMetadata scrape: on" : "\nMetadata scrape: off";
      setStatus(
        `Imported: ${template.name || "-"}\nCanvas: ${template?.canvasSize?.width || "-"}x${template?.canvasSize?.height || "-"}\nLayers: ${layerCount || "-"}\nFonts imported: ${importedCustomFonts}${metadataSuffix}${timingSuffix}${warningSuffix}`,
        "success"
      );
    } catch (error) {
      logger.error("Import failed from popup action", {}, error);
      setStatus(error.message || "Import failed.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

main().catch((error) => {
  logger.error("Popup startup failed", {}, error);
  setStatus(error.message || "Extension startup failed.", "error");
});
