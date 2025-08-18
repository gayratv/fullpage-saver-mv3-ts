/* eslint-disable no-console */
// src/background.ts (MV3 Service Worker, ES module)
// Types are provided by @types/chrome. We target ES2022.

type CaptureFormat = "jpeg" | "png";

interface Plan {
  dpr: number;
  vw: number;
  vh: number;
  sw: number;
  sh: number;
  overlap: number;
  step: number;
  stops: number[];
}

interface Tile {
  y: number;
  dataUrl: string;
}

interface StartOpts {
  format: CaptureFormat;
  quality: number; // 0..1 (ignored for PNG)
  saveAs: boolean;
  hideSticky: boolean;
}

function sanitize(name?: string): string {
  return (name || "page").replace(/[\\/:*?\"<>|]+/g, "_").trim().slice(0, 100) || "page";
}
function ts(): string { return new Date().toISOString().replace(/[:.]/g, "-"); }

let creatingOffscreen: Promise<void> | null = null;
async function ensureOffscreen(path = "offscreen.html"): Promise<void> {
  const url = chrome.runtime.getURL(path);
  try {
    const contexts = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts && contexts.length) return;
  } catch {}
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

async function getPlan(tabId: number): Promise<Plan> {
  const [{ result }] = await chrome.scripting.executeScript<[], Plan>({
    target: { tabId },
    func: () => {
      const dpr = self.devicePixelRatio || 1;
      const vw = innerWidth, vh = innerHeight;
      const sw = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, vw);
      const sh = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, vh);
      const overlap = Math.min(64, Math.floor(vh * 0.08));
      const step = Math.max(1, vh - overlap);
      const stops: number[] = [];
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

async function scrollToY(tabId: number, y: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (top: number) => { window.scrollTo(0, top); },
    args: [y]
  });
}

async function toggleSticky(tabId: number, enable: boolean): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (on: boolean) => {
      const id = "__fps_hide_sticky_style__";
      let el = document.getElementById(id) as HTMLStyleElement | null;
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

async function captureVisible(windowId: number, format: CaptureFormat, quality: number): Promise<string> {
  const opts: chrome.tabs.CaptureVisibleTabOptions =
    format === "png"
      ? { format: "png" }
      : { format: "jpeg", quality: Math.round((quality || 0.92) * 100) };
  return chrome.tabs.captureVisibleTab(windowId, opts);
}

function setBadgeProgress(percent: number): void {
  chrome.action.setBadgeBackgroundColor({ color: "#0b57d0" });
  chrome.action.setBadgeText({ text: String(percent) });
}

async function runCapture(tabId: number, opts: StartOpts): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await ensureOffscreen();
  const plan = await getPlan(tabId);

  if (opts.hideSticky) await toggleSticky(tabId, true);

  const tiles: Tile[] = [];
  for (let i = 0; i < plan.stops.length; i++) {
    const y = plan.stops[i];
    await scrollToY(tabId, y);
    await new Promise(r => setTimeout(r, 120));
    const dataUrl = await captureVisible(tab.windowId!, opts.format, opts.quality);
    tiles.push({ y, dataUrl });
    const pct = Math.min(99, Math.floor(((i + 1) / plan.stops.length) * 100));
    setBadgeProgress(pct);
  }

  const stitched: string = await new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "stitch" });
    const timeout = setTimeout(() => reject(new Error("Offscreen stitch timeout")), 45000);
    port.onMessage.addListener((msg: any) => {
      if (msg?.type === "stitched" && msg.dataUrl) { clearTimeout(timeout); resolve(msg.dataUrl); }
      else if (msg?.type === "error") { clearTimeout(timeout); reject(new Error(msg.message)); }
    });
    port.postMessage({
      type: "stitch",
      plan, tiles,
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

// Listen for popup command
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === "START_CAPTURE" && typeof msg.tabId === "number") {
    runCapture(msg.tabId, msg.opts as StartOpts)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
});
