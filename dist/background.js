// src/background.ts
function sanitize(name) {
  return (name || "page").replace(/[\\/:*?\"<>|]+/g, "_").trim().slice(0, 100) || "page";
}
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
var creatingOffscreen = null;
async function ensureOffscreen(path = "offscreen.html") {
  const url = chrome.runtime.getURL(path);
  try {
    const contexts = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts && contexts.length) return;
  } catch {
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ["BLOBS"],
      justification: "Stitch captured frames via Canvas and export to image"
    });
  }
  await creatingOffscreen;
  creatingOffscreen = null;
}
async function getPlan(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const dpr = self.devicePixelRatio || 1;
      const vw = innerWidth, vh = innerHeight;
      const sw = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, vw);
      const sh = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, vh);
      const overlap = Math.min(64, Math.floor(vh * 0.08));
      const step = Math.max(1, vh - overlap);
      const stops = [];
      for (let y = 0; y < sh; y += step) {
        const pos = Math.min(y, sh - vh);
        if (!stops.length || stops[stops.length - 1] !== pos) stops.push(pos);
        if (y + vh >= sh) break;
      }
      return { dpr, vw, vh, sw, sh, overlap, step, stops };
    }
  });
  return result;
}
async function scrollToY(tabId, y) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (top) => {
      window.scrollTo(0, top);
    },
    args: [y]
  });
}
async function toggleSticky(tabId, enable) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (on) => {
      const id = "__fps_hide_sticky_style__";
      let el = document.getElementById(id);
      if (on) {
        if (el) return;
        el = document.createElement("style");
        el.id = id;
        el.textContent = `
          * { scroll-behavior: auto !important; }
          [style*="position:fixed"], [style*="position: sticky"],
          :is(header,nav,aside,footer).sticky,
          :is(.sticky,.fixed,[data-sticky]) { visibility: hidden !important; }
        `;
        document.documentElement.appendChild(el);
      } else {
        el?.remove();
      }
    },
    args: [enable]
  });
}
async function captureVisible(windowId, format, quality) {
  const opts = format === "png" ? { format: "png" } : { format: "jpeg", quality: Math.round((quality || 0.92) * 100) };
  return chrome.tabs.captureVisibleTab(windowId, opts);
}
function setBadgeProgress(percent) {
  chrome.action.setBadgeBackgroundColor({ color: "#0b57d0" });
  chrome.action.setBadgeText({ text: String(percent) });
}
async function runCapture(tabId, opts) {
  const tab = await chrome.tabs.get(tabId);
  await ensureOffscreen();
  const plan = await getPlan(tabId);
  if (opts.hideSticky) await toggleSticky(tabId, true);
  const tiles = [];
  for (let i = 0; i < plan.stops.length; i++) {
    const y = plan.stops[i];
    await scrollToY(tabId, y);
    await new Promise((r) => setTimeout(r, 120));
    const dataUrl = await captureVisible(tab.windowId, opts.format, opts.quality);
    tiles.push({ y, dataUrl });
    const pct = Math.min(99, Math.floor((i + 1) / plan.stops.length * 100));
    setBadgeProgress(pct);
  }
  const stitched = await new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "stitch" });
    const timeout = setTimeout(() => reject(new Error("Offscreen stitch timeout")), 45e3);
    port.onMessage.addListener((msg) => {
      if (msg?.type === "stitched" && msg.dataUrl) {
        clearTimeout(timeout);
        resolve(msg.dataUrl);
      } else if (msg?.type === "error") {
        clearTimeout(timeout);
        reject(new Error(msg.message));
      }
    });
    port.postMessage({
      type: "stitch",
      plan,
      tiles,
      fileType: opts.format === "png" ? "image/png" : "image/jpeg",
      quality: opts.quality ?? 0.92
    });
  });
  const u = new URL(tab.url || "https://example.com");
  const nameBase = sanitize(`${u.hostname}_${tab.title || "page"}`);
  const ext = opts.format === "png" ? "png" : "jpg";
  const filename = `${nameBase}_${ts()}.${ext}`;
  await chrome.downloads.download({
    url: stitched,
    filename,
    conflictAction: opts.saveAs ? "prompt" : "uniquify",
    saveAs: !!opts.saveAs
  });
  chrome.action.setBadgeText({ text: "" });
  if (opts.hideSticky) await toggleSticky(tabId, false);
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "START_CAPTURE" && typeof msg.tabId === "number") {
    runCapture(msg.tabId, msg.opts).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
//# sourceMappingURL=background.js.map
