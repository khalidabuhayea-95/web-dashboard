// Batch import: walks a list of Canva design URLs and imports each one through the SAME path as
// the popup's "Import current tab" (a port message to background.js). Progress lives in
// chrome.storage.local, so a closed page, a crash or a sleep resumes where it stopped.
const SETTINGS_KEY = "canva_import_settings_v1";
const STATE_KEY = "canva_batch_state_v1";
const PORT_NAME = "canva-import";
const IMPORT_TIMEOUT_MS = 6 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const logger = globalThis.createExtensionLogger ? globalThis.createExtensionLogger("batch") : console;

let running = false;
let state = { items: [], results: {} }; // results[designId] = { status, at, templateId?, error?, name? }

function designIdOf(url) {
  const m = String(url || "").match(/canva\.com\/design\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
}

function parseList(text) {
  const seen = new Set();
  const items = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/https:\/\/www\.canva\.com\/design\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?/);
    if (!m) continue;
    const id = designIdOf(m[0]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Always open the editor view; the importer reads the live editor.
    const parts = m[0].split("/");
    const base = parts.slice(0, 5).join("/"); // https://www.canva.com/design/<id>
    items.push({ id, url: `${base}/edit` });
  }
  return items;
}

async function load() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  if (stored?.[STATE_KEY]) state = stored[STATE_KEY];
  if (state.items.length) $("urls").value = state.items.map((i) => i.url).join("\n");
  render();
}

async function save() {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function counts() {
  const c = { ok: 0, err: 0, pending: 0 };
  for (const item of state.items) {
    const r = state.results[item.id];
    if (r?.status === "ok") c.ok += 1;
    else if (r?.status === "err") c.err += 1;
    else c.pending += 1;
  }
  return c;
}

function render() {
  const c = counts();
  const total = state.items.length;
  $("stats").textContent = total
    ? `${c.ok} تم · ${c.err} فشل · ${c.pending} متبقٍ — من ${total}${running ? " (يعمل…)" : ""}`
    : "لا توجد قائمة بعد";
  $("barFill").style.width = total ? `${((c.ok + c.err) / total) * 100}%` : "0";
  $("start").disabled = running;
  $("pause").disabled = !running;
}

function log(text, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  $("log").prepend(line);
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t?.status === "complete" && done()).catch(done);
    setTimeout(done, 90_000);
  });
}

function importTab(tabId, settings) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: PORT_NAME });
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch (_e) { /* ignore */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("timed out"))), IMPORT_TIMEOUT_MS);
    port.onMessage.addListener((message) => {
      const type = String(message?.type || "");
      if (type === "IMPORT_PROGRESS") return;
      if (type === "IMPORT_SUCCESS") finish(() => resolve(message));
      if (type === "IMPORT_ERROR") finish(() => reject(new Error(message?.error || "import failed")));
    });
    port.onDisconnect.addListener(() =>
      finish(() => reject(new Error(chrome.runtime.lastError?.message || "importer disconnected")))
    );
    port.postMessage({
      type: "IMPORT_ACTIVE_CANVA_TAB",
      tabId,
      dashboardUrl: settings.dashboardUrl,
      token: settings.importToken,
      name: "",
      slug: "",
      captureMetadata: false,
    });
  });
}

async function run() {
  const settings = (await chrome.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
  if (!settings.importToken || !settings.dashboardUrl) {
    log("احفظ رابط الداشبورد والـ token من نافذة الإضافة أولاً.", "err");
    return;
  }
  running = true;
  render();
  // One dedicated window, so the user's own tabs are never touched.
  let win = await chrome.windows.create({ url: "about:blank", focused: true, width: 1400, height: 1000 });
  try {
    for (const item of state.items) {
      if (!running) break;
      if (state.results[item.id]?.status === "ok") continue;
      log(`فتح ${item.id}`);
      let tab = null;
      try {
        // The window must outlive every import tab, so its first (blank) tab stays open; if the
        // user closed the window anyway, open a new one.
        const alive = await chrome.windows.get(win.id).catch(() => null);
        if (!alive) {
          win = await chrome.windows.create({ url: "about:blank", focused: true, width: 1400, height: 1000 });
        }
        tab = await chrome.tabs.create({ windowId: win.id, url: item.url, active: true });
        await waitTabComplete(tab.id);
        await new Promise((r) => setTimeout(r, 4000));
        const result = await importTab(tab.id, settings);
        const t = result?.template || {};
        state.results[item.id] = { status: "ok", at: new Date().toISOString(), templateId: t.id || "", name: t.name || "" };
        log(`✓ ${item.id}  ${t.name || ""}`, "ok");
      } catch (error) {
        const previous = state.results[item.id];
        state.results[item.id] = {
          status: "err",
          at: new Date().toISOString(),
          error: String(error?.message || error),
          tries: (previous?.tries || 0) + 1,
        };
        log(`✗ ${item.id}  ${error?.message || error}`, "err");
      } finally {
        if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
        await save();
        render();
      }
      const gap = Math.max(0, Number($("gap").value) || 0);
      if (gap) await new Promise((r) => setTimeout(r, gap * 1000));
    }
  } finally {
    running = false;
    chrome.windows.remove(win.id).catch(() => {});
    render();
    const c = counts();
    log(`انتهت الدفعة: ${c.ok} تم · ${c.err} فشل · ${c.pending} متبقٍ`);
  }
}

$("file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) $("urls").value = await file.text();
});

$("start").addEventListener("click", async () => {
  const items = parseList($("urls").value);
  if (!items.length) return log("ما في روابط Canva صالحة بالقائمة.", "err");
  // Keep results for designs already in the state; the list itself is replaced.
  if (!$("skipExisting").checked) state.results = {};
  state.items = items;
  await save();
  log(`بدء: ${items.length} تصميم`);
  run().catch((error) => log(String(error?.message || error), "err"));
});

$("pause").addEventListener("click", () => {
  running = false;
  log("سيتوقف بعد التصميم الحالي…");
});

$("retry").addEventListener("click", async () => {
  for (const [id, r] of Object.entries(state.results)) if (r.status === "err") delete state.results[id];
  await save();
  render();
  log("الفاشلة رجعت للقائمة — اضغط «ابدأ».");
});

$("reset").addEventListener("click", async () => {
  if (!confirm("مسح كل التقدم المحفوظ لهذه الدفعة؟ (لا يحذف أي قالب)")) return;
  state = { items: [], results: {} };
  await save();
  $("log").textContent = "";
  render();
});

$("export").addEventListener("click", () => {
  const lines = ["designId\tstatus\ttemplateId\tname\terror\tat"];
  for (const item of state.items) {
    const r = state.results[item.id] || {};
    lines.push([item.id, r.status || "pending", r.templateId || "", r.name || "", r.error || "", r.at || ""].join("\t"));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/tab-separated-values" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `canva-batch-report-${new Date().toISOString().slice(0, 10)}.tsv`;
  a.click();
});

load().catch((error) => log(String(error?.message || error), "err"));
