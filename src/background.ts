/* eslint-disable no-console */
// src/background.ts — MV3 Service Worker (ES module)

import type { CaptureFormat, Plan, Tile, StartOpts } from "./types";


console.debug("service worker start", { version: chrome.runtime.getManifest().version });

function sanitize(name?: string): string {
    return (name || "page").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 100) || "page";
}
function ts(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

let creatingOffscreen: Promise<void> | null = null;
async function ensureOffscreen(path = "offscreen.html"): Promise<void> {
    const url = chrome.runtime.getURL(path);
    try {
        const ctxs = await chrome.runtime.getContexts?.({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
            documentUrls: [url],
        });
        if (ctxs && ctxs.length) return;
    } catch {
        // older Chrome — просто создаём offscreen
    }
    if (!creatingOffscreen) {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: path,
            reasons: ["BLOBS"], // нам нужен Canvas/Blob для склейки и кодирования
            justification: "Stitch captured frames via Canvas and export as image",
        });
    }
    await creatingOffscreen;
    creatingOffscreen = null;
}

/**
 * Временное скрытие «липких» шапок/футеров, плавного окрола и т.п.
 */
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
        args: [enable],
    });
}

/**
 * Инициализируем целевой окрол-контейнер:
 * — ищем самый «высокий» элемент с overflow:auto/scroll;
 * — помечаем его data-атрибутом;
 * — отключаем плавный окрол (детерминированные кадры).
 */
async function initScrollTarget(tabId: number): Promise<void> {
    await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            if ((window as any).__fpsScrollInited) return;
            (window as any).__fpsScrollInited = true;

            function isScrollable(el: Element) {
                const cs = getComputedStyle(el as HTMLElement);
                const oy = cs.overflowY;
                return (oy === "auto" || oy === "scroll") &&
                    (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight;
            }

            const candidates = new Set<Element>();
            if (document.scrollingElement) candidates.add(document.scrollingElement);
            if (document.documentElement)  candidates.add(document.documentElement);
            if (document.body)             candidates.add(document.body);
            document.querySelectorAll<HTMLElement>("*").forEach(el => {
                if (isScrollable(el)) candidates.add(el);
            });

            let target: HTMLElement = (document.scrollingElement || document.documentElement || document.body) as HTMLElement;
            let maxH = target.scrollHeight || 0;
            candidates.forEach((el: any) => {
                const h = el.scrollHeight || 0;
                if (h > maxH) { maxH = h; target = el; }
            });

            target.setAttribute("data-fps-scroll-target", "1");
            (window as any).__fpsScrollSelector = '[data-fps-scroll-target="1"]';

            // отключаем плавный cкрол глобально
            const id = "__fps_scroll_style__";
            if (!document.getElementById(id)) {
                const st = document.createElement("style");
                st.id = id;
                st.textContent = `*{scroll-behavior:auto!important}`;
                document.documentElement.appendChild(st);
            }
        },
    });
}

/**
 * Планируем шаги прокрутки по реальному контейнеру
 */
async function getPlan(tabId: number): Promise<Plan> {
    const [{ result }] = await chrome.scripting.executeScript<[], Plan>({
        target: { tabId },
        func: () => {
            const sel = (window as any).__fpsScrollSelector || "[data-fps-scroll-target='1']";
            const el = document.querySelector(sel) as HTMLElement | null;

            const dpr = self.devicePixelRatio || 1;
            const vw = innerWidth;
            const vh = el ? el.clientHeight : innerHeight;
            const sw = el ? el.scrollWidth : innerWidth;
            const sh = el
                ? el.scrollHeight
                : Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight);

            // перекрытие ~8% вьюпорта, максимум 64px, чтобы сгладить швы/липкие элементы
            const overlap = Math.min(64, Math.floor(vh * 0.08));
            const step = Math.max(1, vh - overlap);

            const stops: number[] = [];
            for (let y = 0; y < sh; y += step) {
                const pos = Math.min(y, sh - vh);
                if (!stops.length || stops[stops.length - 1] !== pos) stops.push(pos);
                if (y + vh >= sh) break;
            }

            return { dpr, vw, vh, sw, sh, overlap, step, stops };
        },
    });
    if (!result) {
        throw new Error("getPlan: script did not return a Plan");
    }
    return result;

}

/**
 * Скроллим найденный контейнер (или window как fallback) и ждём стабильной отрисовки
 */
async function scrollToY(tabId: number, y: number): Promise<void> {
    await chrome.scripting.executeScript({
        target: { tabId },
        func: async (top: number) => {
            const sel = (window as any).__fpsScrollSelector || "[data-fps-scroll-target='1']";
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) {
                el.scrollTop = top;
            } else {
                document.documentElement.scrollTop = top;
                if (document.body)
                    {document.body.scrollTop = top};
                window.scrollTo(0, top);
            }
            // Дадим странице дорисоваться: двойной rAF + микропаузa для lazy-load/виртуализации
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await new Promise(r => setTimeout(r, 550));
        },
        args: [y],
    });
}

async function captureVisible(windowId: number, format: CaptureFormat, quality: number): Promise<string> {
    return chrome.tabs.captureVisibleTab(windowId, {
        format: format === "png" ? "png" : "jpeg",
        quality: format === "png" ? undefined : Math.round((quality || 0.92) * 100),
    });

}

function setBadgeProgress(percent: number): void {
    void chrome.action.setBadgeBackgroundColor({ color: "#0b57d0" });
    void chrome.action.setBadgeText({ text: String(percent) });
}

async function runCapture(tabId: number, opts: StartOpts): Promise<void> {
    console.debug("runCapture start", { tabId, opts });
    const tab = await chrome.tabs.get(tabId);
    console.debug("tab info", { url: tab.url, title: tab.title, windowId: tab.windowId });

    await ensureOffscreen();
    console.debug("offscreen ensured");
    await initScrollTarget(tabId);
    console.debug("scroll target initialized");
    const plan = await getPlan(tabId);
    console.debug("capture plan", plan);

    if (opts.hideSticky) await toggleSticky(tabId, true);
    console.debug("hideSticky", opts.hideSticky);

    const tiles: Tile[] = [];
    for (let i = 0; i < plan.stops.length; i++) {
        const y = plan.stops[i];
        await scrollToY(tabId, y);

        // Увеличиваем паузу здесь, чтобы не превышать квоту
        await new Promise(r => setTimeout(r, 550));

        const dataUrl = await captureVisible(tab.windowId!, opts.format, opts.quality);
        tiles.push({ y, dataUrl });
        console.debug(`captured tile ${i + 1}/${plan.stops.length} at y=${y}`);
        const pct = Math.min(99, Math.floor(((i + 1) / plan.stops.length) * 100));
        setBadgeProgress(pct);
    }

    console.debug("stitching tiles", tiles.length);
    // Stitch в offscreen
    const stitched: string = await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: "stitch" });
        const timeout = setTimeout(() => reject(new Error("Offscreen stitch timeout")), 45000);
        port.onMessage.addListener((msg: any) => {
            if (msg?.type === "stitched" && msg.dataUrl) { clearTimeout(timeout); resolve(msg.dataUrl); }
            else if (msg?.type === "error") { clearTimeout(timeout); reject(new Error(msg.message)); }
        });
        port.postMessage({
            type: "stitch",
            plan,
            tiles,
            fileType: opts.format === "png" ? "image/png" : "image/jpeg",
            quality: opts.quality ?? 0.92,
        });
    });
    console.debug("stitching done", { length: stitched.length });

    // Сохранение
    const u = new URL(tab.url || "https://example.com");
    const nameBase = sanitize(`${u.hostname}_${tab.title || "page"}`);
    const ext = opts.format === "png" ? "png" : "jpg";
    const filename = `${nameBase}_${ts()}.${ext}`;
    console.debug("initiating download", filename);

    await chrome.downloads.download({
        url: stitched,
        filename,
        conflictAction: opts.saveAs ? "prompt" : "uniquify",
        saveAs: opts.saveAs,
    });
    console.debug("download triggered", filename);

    void  chrome.action.setBadgeText({ text: "" });
    if (opts.hideSticky) await toggleSticky(tabId, false);
    console.debug("runCapture finished");
}

// Слушаем команду из popup
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    console.debug("onMessage", msg);
    if (msg?.type === "START_CAPTURE" && typeof msg.tabId === "number") {
        runCapture(msg.tabId, msg.opts as StartOpts)
            .then(() => sendResponse({ ok: true }))
            .catch(e => {
                console.error("runCapture error:", e);
                sendResponse({ ok: false, error: String(e) });
            });
        return true; // async
    }
});
