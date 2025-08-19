// src/popup.ts

const q = document.getElementById("quality") as HTMLInputElement;
const qv = document.getElementById("qv") as HTMLSpanElement;
q.addEventListener("input", () => (qv.textContent = q.value));

(document.getElementById("start") as HTMLButtonElement).addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const opts = {
        format: (document.getElementById("format") as HTMLSelectElement).value as "jpeg" | "png",
        quality: parseInt(q.value, 10) / 100,
        saveAs: (document.getElementById("saveAs") as HTMLInputElement).checked,
        hideSticky: (document.getElementById("hideSticky") as HTMLInputElement).checked,
        saveDir: (document.getElementById("saveDir") as HTMLInputElement).value.trim() || "screenshots",
    };
    (document.getElementById("start") as HTMLButtonElement).disabled = true;
    // eslint-disable-next-line no-console
    console.debug("popup start", { tabId: tab.id, opts });
    try {
        await chrome.runtime.sendMessage({ type: "START_CAPTURE", tabId: tab.id, opts });
        window.close();
    } catch (e) {
        console.error(e);
        (document.getElementById("start") as HTMLButtonElement).disabled = false;
    }
});
