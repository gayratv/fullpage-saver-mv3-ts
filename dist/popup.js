// src/popup.ts
var q = document.getElementById("quality");
var qv = document.getElementById("qv");
q.addEventListener("input", () => qv.textContent = q.value);
document.getElementById("start").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const opts = {
    format: document.getElementById("format").value,
    quality: parseInt(q.value, 10) / 100,
    saveAs: document.getElementById("saveAs").checked,
    hideSticky: document.getElementById("hideSticky").checked
  };
  document.getElementById("start").disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: "START_CAPTURE", tabId: tab.id, opts });
    window.close();
  } catch (e) {
    console.error(e);
    document.getElementById("start").disabled = false;
  }
});
//# sourceMappingURL=popup.js.map
