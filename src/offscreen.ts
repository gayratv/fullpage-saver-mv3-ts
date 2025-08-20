/* eslint-disable no-console */
import type { Plan, Tile } from "./types";

// Offscreen document to stitch tiles together

async function stitch(plan: Plan, tiles: Tile[], fileType: string, quality: number, port: chrome.runtime.Port): Promise<string> {
    port.postMessage({ type: "debug_log", message: `offscreen stitch start, { plan:${plan}` });

    const { dpr, sw, sh, overlap, headerHeight, stops } = plan;

    const canvas = new OffscreenCanvas(sw * dpr, sh * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");

    ctx.imageSmoothingEnabled = false;

    let currentY = 0;

    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const img = await createImageBitmap(await (await fetch(tile.dataUrl)).blob());

        const isFirst = i === 0;
        const sY = isFirst ? 0 : headerHeight ;
        const sHeight = img.height - sY;
        const dY = currentY;

        // Выводим отладочную информацию и отправляем ее в background.ts
        port.postMessage({ type: "debug_log", message: `Frame ${i + 1}: sY=${sY}, dY=${dY}, sHeight=${sHeight}, stops[i]=${stops[i]}` });

        // ctx.drawImage(img, 0, sY, img.width, sHeight, 0, dY+sY, img.width, sHeight);
        ctx.drawImage(img, 0, sY, img.width, sHeight, 0, stops[i]+sY, img.width, sHeight);

        // Создаем временный canvas для сохранения обрезанного кадра
        const tempCanvas = new OffscreenCanvas(img.width, sHeight);
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
            tempCtx.drawImage(img, 0, sY, img.width, sHeight, 0, 0, img.width, sHeight);
            const blob = await tempCanvas.convertToBlob({ type: fileType, quality });
            const dataUrl = URL.createObjectURL(blob);
            port.postMessage({ type: "debug_frame", dataUrl, frameIndex: i + 1 });
        }

        currentY += sHeight - overlap ;
    }

    const blob = await canvas.convertToBlob({ type: fileType, quality });
    return URL.createObjectURL(blob);
}

chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "stitch") return;

    port.onMessage.addListener(async (msg: any) => {
        if (msg.type === "stitch") {
            try {
                const dataUrl = await stitch(msg.plan, msg.tiles, msg.fileType, msg.quality, port);
                port.postMessage({ type: "stitched", dataUrl });
            } catch (e) {
                console.error("offscreen stitch failed:", e);
                port.postMessage({ type: "error", message: String(e) });
            }
        }
    });
});
