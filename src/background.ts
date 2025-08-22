/* eslint-disable no-console */
// src/background.ts — MV3 Service Worker (ES module)

import {CaptureFormat, Plan, Tile, StartOpts, OffscreenRequest, OffscreenIncoming} from "./types";

const HEADER_VERTICAL_PADDING = 0; // box-shadow: 0 0 10px rgba(50,50,50,.75);
// const SCROLL_TARGET_ATTR = "data-fps-scroll-target";
// const SCROLLABLE_ELEMENT="#page-container"

console.debug("service worker start", {version: chrome.runtime.getManifest().version});

/**
 * Получает имя следующей поддиректории для загрузки, увеличивая счетчик в chrome.storage.
 * @returns {Promise<string>} Имя поддиректории, например "DL-001".
 */
async function getNextDownloadDirectory(): Promise<string> {
    const {dlCounter} = await chrome.storage.local.get({dlCounter: 0});
    const next = (dlCounter || 0) + 1;
    await chrome.storage.local.set({dlCounter: next});
    return `DL-${String(next).padStart(3, "0")}`;
}

function sanitize(s: string): string {
    return s
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
}

function ts(): string {
    const d = new Date();
    const z = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

async function ensureOffscreen(): Promise<void> {
    const has = await chrome.offscreen.hasDocument?.();
    if (!has) {
        await chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: [chrome.offscreen.Reason.BLOBS],
            justification: "Stitching captured tiles into one image",
        });
        console.debug("offscreen created");
    } else {
        console.debug("offscreen already exists");
    }
}

async function initAndGetScrollTarget(tabId: number): Promise<string> {
    const [{result}] = await chrome.scripting.executeScript({
        target: {tabId},
        func: () => {
            // Инициализация и поиск скролл-контейнера на странице.
            // Можно вынести в отдельный файл/модуль при необходимости.
            const el = document.querySelector("#page-container") || document.scrollingElement || document.body;

            return el ? (el as HTMLElement).id || "#document" : "#document";
        },
    });
    return String(result || "#document");
}

async function getPlan(tabId: number, scrollSelector: string): Promise<Plan> {
    const [{result}] = await chrome.scripting.executeScript({
        target: {tabId},
        func: (selector: string, HEADER_VERTICAL_PADDING: number) => {
            const dpr = window.devicePixelRatio || 1;
            const innerWidth = window.innerWidth;
            const innerHeight = window.innerHeight;
            const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, innerWidth);
            const sh = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight);
            const vh = innerHeight;
            const overlap = Math.round(vh * 0.15);
            const step = vh - overlap;
            const stops: number[] = [0];
            let lastPos = 0;
            while (lastPos < sh - vh) {
                lastPos += step;
                stops.push(Math.min(lastPos, sh - vh));
            }
            const headerHeight = HEADER_VERTICAL_PADDING; // подправим, если надо
            const lastPosCorrection = lastPos - stops.at(-1)!;
            return {
                dpr,
                vw: innerWidth,
                innerWidth,
                innerHeight,
                vh,
                sw,
                sh,
                overlap,
                step,
                stops,
                headerHeight,
                lastPosCorrection,
                scrollSelector: selector,
            };
        },
        args: [scrollSelector, HEADER_VERTICAL_PADDING],
    });
    return result as Plan;
}

async function toggleHeaderShadow(tabId: number, on: boolean): Promise<void> {
    await chrome.scripting.insertCSS({
        target: {tabId},
        css: on
            ? `header { box-shadow: 0 0 10px rgba(50,50,50,.75) !important; }`
            : `header { box-shadow: none !important; }`,
    });
}

async function toggleSticky(tabId: number, on: boolean): Promise<void> {
    await chrome.scripting.insertCSS({
        target: {tabId},
        css: on
            ? `* { scroll-behavior: auto !important; } .sticky, [style*="position: sticky"] { position: static !important; }`
            : ``,
    });
}

async function scrollToY(tabId: number, y: number, selector: string): Promise<void> {
    await chrome.scripting.executeScript({
        target: {tabId},
        func: (yy: number, sel: string) => {
            const target = sel === "#document" ? window : document.querySelector(sel);
            if (!target) return;
            if (target === window) {
                window.scrollTo({top: yy, behavior: "instant" as ScrollBehavior});
            } else {
                (target as HTMLElement).scrollTo({top: yy, behavior: "instant" as ScrollBehavior});
            }
        },
        args: [y, selector],
    });
}

async function captureVisible(windowId: number, format: CaptureFormat, quality: number): Promise<string> {
    return await chrome.tabs.captureVisibleTab(windowId, {
        format,
        quality: Math.round(quality * 100),
    });
}

function setBadgeProgress(percent: number): void {
    void chrome.action.setBadgeBackgroundColor({color: "#0b57d0"});
    void chrome.action.setBadgeText({text: String(percent)});
}

/** Метаданные и коллбеки для обработки сообщений от offscreen */
type PendingStitchMeta = {
    resolve: (dataUrl: string) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    downloadSubDir: string;
    nameBase: string;
    timestamp: string;
    ext: string;
    port: chrome.runtime.Port;
};

/**
 * Создаёт обработчик сообщений от offscreen-страницы для стыковки тайлов.
 * Вынесено за пределы runCapture, чтобы listener не определялся заново каждый раз.
 */
function makeStitchPortListener(meta: PendingStitchMeta) {
    return (msg: OffscreenIncoming): void => {
        switch (msg.type) {
            case "stitched": {
                if (msg.dataUrl) {
                    clearTimeout(meta.timeout);
                    try {
                        meta.resolve(msg.dataUrl);
                    } finally {
                        meta.port.disconnect();
                    }
                }
                break;
            }
            case "error": {
                clearTimeout(meta.timeout);
                try {
                    meta.reject(new Error(msg.message ?? "Offscreen stitch error"));
                } finally {
                    meta.port.disconnect();
                }
                break;
            }
            case "debug_log": {
                // Отладочные сообщения для консоли
                if (msg.message) console.log("Offscreen debug log:", msg.message);
                break;
            }
            case "debug_frame": {
                const idx = typeof msg.frameIndex === "number" ? msg.frameIndex : 0;
                const debugFilename = `${meta.downloadSubDir}/${meta.nameBase}_${meta.timestamp}_debug_frame_cropped_${String(idx).padStart(3, "0")}.${meta.ext}`;
                if (msg.dataUrl) {
                    void chrome.downloads.download({
                        url: msg.dataUrl,
                        filename: debugFilename,
                        conflictAction: "uniquify",
                        saveAs: false,
                    });
                }
                break;
            }
        }
    };
}

async function runCapture(tabId: number, opts: StartOpts): Promise<void> {
    console.debug("runCapture start", {tabId, opts});
    const tab = await chrome.tabs.get(tabId);
    console.debug("tab info", {url: tab.url, title: tab.title, windowId: tab.windowId});

    const downloadSubDir = await getNextDownloadDirectory();
    console.debug(`Using download subdirectory: ${downloadSubDir}`);

    await toggleHeaderShadow(tabId, true);
    if (opts.hideSticky) await toggleSticky(tabId, true);

    try {
        await ensureOffscreen();
        console.debug("offscreen ensured");

        const scrollSelector = await initAndGetScrollTarget(tabId);
        console.debug("scroll target initialized", {selector: scrollSelector});

        const plan = await getPlan(tabId, scrollSelector);
        console.debug("capture plan", plan);

        const u = new URL(tab.url || "https://example.com");
        const nameBase = sanitize(`${u.hostname}_${tab.title || "page"}`);
        const ext = opts.format === "png" ? "png" : "jpg";
        const timestamp = ts(); // Единая временная метка для всей сессии захвата

        const tiles: Tile[] = [];
        for (let i = 0; i < plan.stops.length; i++) {
            const y = plan.stops[i];
            await scrollToY(tabId, y, scrollSelector);
            await new Promise(r => setTimeout(r, 550));
            const dataUrl = await captureVisible(tab.windowId!, opts.format, opts.quality);
            tiles.push({y, dataUrl});

            console.debug(`captured tile ${i + 1}/${plan.stops.length} at y=${y}`);
            const pct = Math.min(99, Math.floor(((i + 1) / plan.stops.length) * 100));
            setBadgeProgress(pct);
        }

        console.debug("stitching tiles", tiles.length);
        const stitched: string = await new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({name: "stitch"});
            const timeout = setTimeout(() => reject(new Error("Offscreen stitch timeout")), 45000);

            const listener = makeStitchPortListener({ resolve, reject, timeout, downloadSubDir, nameBase, timestamp, ext, port });
            port.onMessage.addListener(listener);

            const stitch_msg: OffscreenRequest = {
                type: "stitch",
                plan,
                tiles,
                fileType: opts.format === "png" ? "image/png" : "image/jpeg",
                quality: opts.quality,
                drawCroppedImage:false
            };
            port.postMessage(stitch_msg);
        });
        console.debug("stitching done", {length: stitched.length});

        const finalFilename = `${downloadSubDir}/${nameBase}_${timestamp}_stitched.${ext}`;
        console.debug("initiating download", finalFilename);

        await chrome.downloads.download({
            url: stitched,
            filename: finalFilename,
            conflictAction: opts.saveAs ? "prompt" : "uniquify",
            saveAs: opts.saveAs,
        });
        console.debug("download triggered", finalFilename);

    } finally {
        void chrome.action.setBadgeText({text: ""});
        // await toggleHeaderShadow(tabId, false);
        if (opts.hideSticky) await toggleSticky(tabId, false);
        console.debug("runCapture finished, cleanup complete.");
    }
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    console.debug("onMessage", msg);
    if (msg?.type === "START_CAPTURE" && typeof msg.tabId === "number") {
        runCapture(msg.tabId,
            {
                format: (msg.format || "jpeg"),
                quality: (typeof msg.quality === "number" ? msg.quality : 0.92),
                saveAs: !!msg.saveAs,
                hideSticky: !!msg.hideSticky,
            })
            .then(() => sendResponse({ok: true}))
            .catch((e) => {
                console.error("runCapture error", e);
                sendResponse({ok: false, error: String(e)});
            });
        return true;
    }
});
