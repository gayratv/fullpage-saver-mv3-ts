/* eslint-disable no-console */
// src/background.ts — MV3 Service Worker (ES module)

import type { CaptureFormat, Plan, StartOpts } from "./types";


console.debug("service worker start", { version: chrome.runtime.getManifest().version });

function sanitize(name?: string): string {
    return (name || "page").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 100) || "page";
}
function ts(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
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
        target: { tabId },
        func: () => {
            const container = document.querySelector('#page-container');
            if (container) {
                container.setAttribute("data-fps-scroll-target", "1");
                return '#page-container';
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
    const [{ result }] = await chrome.scripting.executeScript<[string], Plan>({
        target: { tabId },
        args: [selector],
        func: (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) throw new Error(`Scroll target not found: ${sel}`);

            const dpr = self.devicePixelRatio || 1;
            const vw = innerWidth;
            const vh = el.clientHeight;
            const sw = el.scrollWidth;
            const sh = el.scrollHeight;

            const overlap = Math.min(64, Math.floor(vh * 0.08));
            const step = Math.max(1, vh - overlap);

            const stops: number[] = [0];
            let lastPos = 0;
            while (lastPos < sh - vh) {
                lastPos += step;
                stops.push(Math.min(lastPos, sh - vh));
            }

            return { dpr, vw, vh, sw, sh, overlap, step, stops };
        },
    });
    if (!result) {
        throw new Error("getPlan: script did not return a Plan");
    }
    return result;
}

async function scrollToY(tabId: number, y: number, selector: string): Promise<void> {
    await chrome.scripting.executeScript({
        target: { tabId },
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
    void chrome.action.setBadgeBackgroundColor({ color: "#0b57d0" });
    void chrome.action.setBadgeText({ text: String(percent) });
}

async function runCapture(tabId: number, opts: StartOpts): Promise<void> {
    console.debug("runCapture start", { tabId, opts });
    const tab = await chrome.tabs.get(tabId);
    console.debug("tab info", { url: tab.url, title: tab.title, windowId: tab.windowId });

    const scrollSelector = await initAndGetScrollTarget(tabId);
    console.debug("scroll target initialized", { selector: scrollSelector });

    const plan = await getPlan(tabId, scrollSelector);
    console.debug("capture plan", plan);

    if (opts.hideSticky) await toggleSticky(tabId, true);
    console.debug("hideSticky", opts.hideSticky);

    const u = new URL(tab.url || "https://example.com");
    const nameBase = sanitize(`${u.hostname}_${tab.title || "page"}`);
    const ext = opts.format === "png" ? "png" : "jpg";
    const timestamp = ts();

    for (let i = 0; i < plan.stops.length; i++) {
        const y = plan.stops[i];
        await scrollToY(tabId, y, scrollSelector);
        await new Promise(r => setTimeout(r, 550));
        const dataUrl = await captureVisible(tab.windowId!, opts.format, opts.quality);

        const filename = `${nameBase}_${timestamp}_${String(i + 1).padStart(2, "0")}.${ext}`;
        console.debug(`initiating download for tile ${i + 1}`, filename);
        // Not awaiting is fine, let it run in the background.
        chrome.downloads.download({
            url: dataUrl,
            filename,
            conflictAction: "uniquify",
            saveAs: false, // saveAs is not practical for multiple files
        });

        console.debug(`captured tile ${i + 1}/${plan.stops.length} at y=${y}`);
        const pct = Math.min(99, Math.floor(((i + 1) / plan.stops.length) * 100));
        setBadgeProgress(pct);
    }

    void chrome.action.setBadgeText({ text: "" });
    if (opts.hideSticky) await toggleSticky(tabId, false);
    console.debug("runCapture finished");
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    console.debug("onMessage", msg);
    if (msg?.type === "START_CAPTURE" && typeof msg.tabId === "number") {
        runCapture(msg.tabId, msg.opts as StartOpts)
            .then(() => sendResponse({ ok: true }))
            .catch(e => {
                console.error("runCapture failed:", e);
                sendResponse({ ok: false, error: String(e) });
            });
        return true;
    }
});
