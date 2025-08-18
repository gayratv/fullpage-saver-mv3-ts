/* eslint-disable no-console */
// src/background.ts — MV3 Service Worker (ES module)
// Новая логика с использованием Debugger API

import type { StartOpts } from "./types";

console.debug("service worker start", { version: chrome.runtime.getManifest().version });

function sanitize(name?: string): string {
    return (name || "page").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 100) || "page";
}

function ts(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

// Вспомогательная функция для работы с Debugger API через Promise
// Вспомогательная функция для работы с Debugger API через Promise
function sendDebuggerCommand(target: chrome.debugger.Debuggee, method: string, params?: { [key: string]: any }): Promise<any> {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(target, method, params, (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(result);
            }
        });
    });
}

async function runCapture(tabId: number, opts: StartOpts): Promise<void> {
    console.debug("runCapture start", { tabId, opts });
    const tab = await chrome.tabs.get(tabId);
    console.debug("tab info", { url: tab.url, title: tab.title });

    const debuggee = { tabId: tabId };
    const protocolVersion = "1.3";

    try {
        // 1. Подключаем отладчик к вкладке
        await chrome.debugger.attach(debuggee, protocolVersion);
        console.debug("Debugger attached");

        // 2. Получаем размеры всей страницы
        const { contentSize } = await sendDebuggerCommand(debuggee, "Page.getLayoutMetrics") as { contentSize: { width: number, height: number }};
        console.debug("Layout metrics", contentSize);

        if (contentSize.height === 0) {
            throw new Error("Не удалось определить высоту страницы. Возможно, страница еще загружается.");
        }

        setBadgeProgress(50);

        // 3. Делаем скриншот всей страницы за один раз
        const screenshotResult = await sendDebuggerCommand(debuggee, "Page.captureScreenshot", {
            format: opts.format === "png" ? "png" : "jpeg",
            quality: opts.format === "jpeg" ? Math.round(opts.quality * 100) : undefined,
            clip: {
                x: 0,
                y: 0,
                width: contentSize.width,
                height: contentSize.height,
                scale: 1,
            },
            captureBeyondViewport: true, // <-- Ключевой параметр!
        }) as { data: string };

        console.debug("Screenshot captured");
        const dataUrl = `data:image/${opts.format};base64,${screenshotResult.data}`;

        // 4. Сохраняем файл
        const u = new URL(tab.url || "https://example.com");
        const nameBase = sanitize(`${u.hostname}_${tab.title || "page"}`);
        const ext = opts.format === "png" ? "png" : "jpg";
        const filename = `${nameBase}_${ts()}.${ext}`;
        console.debug("Initiating download", filename);

        await chrome.downloads.download({
            url: dataUrl,
            filename,
            conflictAction: opts.saveAs ? "prompt" : "uniquify",
            saveAs: opts.saveAs,
        });

        setBadgeProgress(100);
        console.debug("Download triggered");

    } catch (e) {
        console.error("Capture failed:", e);
        // Можно добавить уведомление для пользователя об ошибке
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (message: string) => { alert(`Ошибка захвата страницы:\n${message}`); },
            args: [String(e)]
        });

    } finally {
        // 5. Обязательно отключаем отладчик
        await chrome.debugger.detach(debuggee);
        console.debug("Debugger detached");
        void chrome.action.setBadgeText({ text: "" });
    }
}

function setBadgeProgress(percent: number): void {
    void chrome.action.setBadgeBackgroundColor({ color: "#0b57d0" });
    const text = percent === 100 ? "✓" : String(percent);
    void chrome.action.setBadgeText({ text });
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