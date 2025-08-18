/* eslint-disable no-console */
// src/background.ts — MV3 Service Worker (ES module)
// Финальная логика: загрузка и выполнение скрипта поиска из файла

import type { StartOpts } from "./types";

function sanitize(name?: string): string {
    return (name || "page").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 100) || "page";
}

function ts(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

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
    const debuggee = { tabId: tabId };
    const protocolVersion = "1.3";

    try {
        await chrome.debugger.attach(debuggee, protocolVersion);
        console.debug("Debugger attached");
        setBadgeProgress(25);

        // 2. НОВАЯ ЛОГИКА: Загружаем и выполняем скрипт поиска из файла
        const findElementUrl = chrome.runtime.getURL('content/findElement.js');
        const response = await fetch(findElementUrl);
        const findElementCode = await response.text();

        const { result: { value: elementMetrics } } = await sendDebuggerCommand(debuggee, "Runtime.evaluate", {
            expression: `${findElementCode}; findTargetElement();`, // Выполняем код и сразу вызываем функцию
            returnByValue: true,
        });

        if (!elementMetrics) {
            throw new Error("Не удалось найти целевой контейнер (результат из findElement.js пустой).");
        }

        console.debug("Container metrics found via fetched script:", elementMetrics);
        setBadgeProgress(50);

        // 3. Делаем скриншот ТОЛЬКО этой области
        const screenshotResult = await sendDebuggerCommand(debuggee, "Page.captureScreenshot", {
            format: opts.format === "png" ? "png" : "jpeg",
            quality: opts.format === "jpeg" ? Math.round(opts.quality * 100) : undefined,
            clip: {
                x: elementMetrics.x,
                y: elementMetrics.y,
                width: elementMetrics.width,
                height: elementMetrics.height,
                scale: 1,
            },
            captureBeyondViewport: true,
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
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (message: string) => {
                const errorBox = document.createElement('div');
                errorBox.style.position = 'fixed';
                errorBox.style.top = '20px';
                errorBox.style.right = '20px';
                errorBox.style.padding = '20px';
                errorBox.style.backgroundColor = '#ffdddd';
                errorBox.style.border = '1px solid #ff0000';
                errorBox.style.borderRadius = '8px';
                errorBox.style.zIndex = '2147483647';
                errorBox.style.fontFamily = 'sans-serif';
                errorBox.style.fontSize = '16px';
                errorBox.textContent = `Ошибка захвата страницы: ${message}`;
                document.body.appendChild(errorBox);
                setTimeout(() => errorBox.remove(), 5000);
            },
            args: [String(e)]
        }).catch(err => console.error("Failed to show error message:", err));

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
