/* eslint-disable no-console */
// src/background.ts — MV3 Service Worker (ES module)

import {CaptureFormat, Plan, Tile, StartOpts, OffscreenRequest} from "./types";

const HEADER_VERTICAL_PADDING = 0; // box-shadow: 0 0 10px rgba(50,50,50,.75);
// const SCROLL_TARGET_ATTR = "data-fps-scroll-target";
// const SCROLLABLE_ELEMENT="#page-container"

console.debug("service worker start", {version: chrome.runtime.getManifest().version});

/**
 * Получает имя следующей поддиректории для загрузки, увеличивая счетчик в chrome.storage.
 * @returns {Promise<string>} Имя поддиректории, например "DL-001".
 */
async function getNextDownloadDirectory(): Promise<string> {
    const key = 'lastDirIndex';
    const result = await chrome.storage.local.get([key]);
    const lastIndex = result[key] || 0;
    const newIndex = lastIndex + 1;
    await chrome.storage.local.set({[key]: newIndex});
    return `DL-${String(newIndex).padStart(3, '0')}`;
}

function sanitize(name?: string): string {
    return (name || "page").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 100) || "page";
}

function ts(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

let creatingOffscreen: Promise<void> | null = null;

/**
 * Гарантирует наличие и доступность offscreen-документа.
 * В Manifest V3 service workers не имеют прямого доступа к DOM, который необходим
 * для таких задач, как создание canvas и манипуляции с изображениями.
 * Offscreen API предоставляет способ запустить документ в фоновом режиме с доступом к DOM.
 *
 * Эта функция сначала проверяет, существует ли уже offscreen-документ с указанным путем.
 * Если он существует, функция ничего не делает.
 * Если нет, она создает новый offscreen-документ.
 * Мьютекс (`creatingOffscreen`) используется для предотвращения состояний гонки, когда несколько
 * частей расширения могут одновременно пытаться создать offscreen-документ.
 *
 * @param path Путь к HTML-файлу для offscreen-документа.
 */
async function ensureOffscreen(path = "offscreen.html"): Promise<void> {
    const url = chrome.runtime.getURL(path);
    // Проверяем, открыт ли уже offscreen-документ
    // Если нет, создаем его
    try {
        const ctxs = await chrome.runtime.getContexts?.({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
            documentUrls: [url],
        });
        if (ctxs && ctxs.length) return;
    } catch {
        // older Chrome — просто создаём offscreen
    }
    if (!creatingOffscreen) {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: path,
            reasons: [chrome.offscreen.Reason.DOM_PARSER],
            justification: "Stitch captured frames via Canvas and export as image",
        });
    }
    await creatingOffscreen;
    creatingOffscreen = null;
}

async function toggleHeaderShadow(tabId: number, enable: boolean): Promise<void> {
    await chrome.scripting.executeScript({
        target: {tabId},
        func: (on: boolean) => {
            const id = "__fps_hide_header_shadow_style__";
            let el = document.getElementById(id) as HTMLStyleElement | null;
            if (on) {
                if (el) return;
                el = document.createElement("style");
                el.id = id;
                el.textContent = `
          body > header > nav { box-shadow: none !important; }
        `;
                document.documentElement.appendChild(el);
            } else {
                el?.remove();
            }
        },
        args: [enable],
    });
}

async function toggleSticky(tabId: number, enable: boolean): Promise<void> {
    await chrome.scripting.executeScript({
        target: {tabId},
        func: (on: boolean) => {
            const id = "__fps_hide_sticky_style__";
            let el = document.getElementById(id) as HTMLStyleElement | null;
            if (on) {
                if (el) return;
                el = document.createElement("style");
                el.id = id;
                el.textContent = `
          * { scroll-behavior: auto !important; }
          [style*="position:fixed"], [style*="position: sticky"] { visibility: hidden !important; }
        `;
                document.documentElement.appendChild(el);
            } else {
                el?.remove();
            }
        },
        args: [enable],
    });
}

async function initAndGetScrollTarget(tabId: number): Promise<string> {
    const injectionResults = await chrome.scripting.executeScript<[], string>({
        target: {tabId},
        func: () => {
            const container = document.querySelector("#page-container");
            if (container) {
                container.setAttribute("data-fps-scroll-target", "1");
                return "#page-container";
            }

            // Fallback to documentElement if specific container not found
            document.documentElement.setAttribute("data-fps-scroll-target", "1");
            return '[data-fps-scroll-target="1"]';
        },
    });

    if (!injectionResults || !injectionResults[0] || !injectionResults[0].result) {
        throw new Error("Could not determine the scroll target on the page.");
    }
    return injectionResults[0].result;
}

async function getPlan(tabId: number, selector: string): Promise<Plan> {
    const injectionResults = await chrome.scripting.executeScript<[string, number], { data?: Plan; error?: string }>({
        target: {tabId},
        args: [selector, HEADER_VERTICAL_PADDING],
        func: (sel, headerPadding) => {
            try {
                const el = document.querySelector(sel) as HTMLElement | null;
                if (!el) {
                    return {error: `Scroll target not found: ${sel}`};
                }

                const header = document.querySelector("body > header") as HTMLElement | null;

                const dpr = self.devicePixelRatio || 1;
                const vw = innerWidth;
                const vh = el.clientHeight;
                const sw = el.scrollWidth;
                const sh = el.scrollHeight;
                const headerHeight = (header ? header.offsetHeight : 0) + headerPadding;

                if (vh === 0 || sh === 0) {
                    return {error: `Invalid dimensions: vh=${vh}, sh=${sh}`};
                }

                const overlap = Math.min(64, Math.floor(vh * 0.08));
                // const overlap = 10;
                const step = Math.max(1, vh - overlap);

                const stops: number[] = [0];
                let lastPos = 0;
                while (lastPos < sh - vh) {
                    lastPos += step;
                    stops.push(Math.min(lastPos, sh - vh));
                }
                // в конце lastPos==3816  stops.at(-1)==3586

                const lastPosCorrection = lastPos - stops.at(-1)!;
                const plan = {
                    dpr,
                    vw,
                    innerWidth,
                    innerHeight,
                    vh,
                    sw,
                    sh,
                    overlap,
                    step,
                    stops,
                    headerHeight,
                    lastPosCorrection
                };
                return {data: plan};
            } catch (e) {
                return {error: e instanceof Error ? e.message : String(e)};
            }
        },
    });

    if (!injectionResults || injectionResults.length === 0) {
        throw new Error("getPlan: script injection failed unexpectedly.");
    }

    const mainFrameResult = injectionResults[0].result;

    if (!mainFrameResult) {
        throw new Error("getPlan: script did not return any result object.");
    }

    if (mainFrameResult.error) {
        throw new Error(`getPlan script failed: ${mainFrameResult.error}`);
    }

    if (!mainFrameResult.data) {
        throw new Error("getPlan: script did not return a Plan (no data).");
    }

    return mainFrameResult.data;
}

async function scrollToY(tabId: number, y: number, selector: string): Promise<void> {
    await chrome.scripting.executeScript({
        target: {tabId},
        args: [y, selector],
        func: async (top: number, sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) {
                el.scrollTop = top;
            } else {
                window.scrollTo(0, top);
            }

            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await new Promise(r => setTimeout(r, 150));
        },
    });
}

async function captureVisible(windowId: number, format: CaptureFormat, quality: number): Promise<string> {
    return chrome.tabs.captureVisibleTab(windowId, {
        format: format === "png" ? "png" : "jpeg",
        quality: format === "png" ? undefined : Math.round((quality || 0.92) * 100),
    });
}

function setBadgeProgress(percent: number): void {
    void chrome.action.setBadgeBackgroundColor({color: "#0b57d0"});
    void chrome.action.setBadgeText({text: String(percent)});
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

            const frameFilename = `${downloadSubDir}/${nameBase}_${timestamp}_frame_${String(i + 1).padStart(3, "0")}.${ext}`;
            chrome.downloads.download({
                url: dataUrl,
                filename: frameFilename,
                conflictAction: "uniquify",
                saveAs: false,
            });

            console.debug(`captured tile ${i + 1}/${plan.stops.length} at y=${y}`);
            const pct = Math.min(99, Math.floor(((i + 1) / plan.stops.length) * 100));
            setBadgeProgress(pct);
        }

        console.debug("stitching tiles", tiles.length);
        const stitched: string = await new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({name: "stitch"});
            const timeout = setTimeout(() => reject(new Error("Offscreen stitch timeout")), 45000);

            port.onMessage.addListener((msg: {
                type: string;
                dataUrl?: string;
                message?: string;
                frameIndex?: number
            }) => {
                switch (msg.type) {
                    case "stitched":
                        if (msg.dataUrl) {
                            clearTimeout(timeout);
                            resolve(msg.dataUrl);
                        }
                        break;
                    case "error":
                        clearTimeout(timeout);
                        reject(new Error(msg.message));
                        break;
                    case "debug_log":
                        console.log("Offscreen debug log:", msg.message);
                        break;
                    case "debug_frame": {
                        const debugFilename = `${downloadSubDir}/${nameBase}_${timestamp}_debug_frame_cropped_${String(msg.frameIndex).padStart(3, "0")}.${ext}`;
                        chrome.downloads.download({
                            url: msg.dataUrl!, filename: debugFilename, conflictAction: "uniquify", saveAs: false,
                        });
                    }
                        break;
                }
            });

            const stitch_msg: OffscreenRequest = {
                type: "stitch",
                plan,
                tiles,
                fileType: opts.format === "png" ? "image/png" : "image/jpeg",
                quality: opts.quality ?? 0.92,
                drawCroppedImage: false
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
        runCapture(msg.tabId, msg.opts as StartOpts)
            .then(() => sendResponse({ok: true}))
            .catch(e => {
                console.error("runCapture failed:", e);
                sendResponse({ok: false, error: String(e)});
            });
        return true;
    }
});
