/* eslint-disable no-console */
import type { Plan, Tile } from "./types";

// Offscreen document to stitch tiles together

async function stitch(plan: Plan, tiles: Tile[], fileType: string, quality: number): Promise<string> {
    console.debug("offscreen stitch start", { plan, tiles: tiles.length, fileType, quality });

    const { dpr, sw, sh, overlap, headerHeight } = plan;

    const canvas = new OffscreenCanvas(sw * dpr, sh * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");

    ctx.imageSmoothingEnabled = false;

    let currentY = 0;

    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const img = await createImageBitmap(await (await fetch(tile.dataUrl)).blob());

        const isFirst = i === 0;
        const sY = isFirst ? 0 : headerHeight * dpr;
        const sHeight = img.height - sY;
        const dY = currentY;

        ctx.drawImage(img, 0, sY, img.width, sHeight, 0, dY, img.width, sHeight);

        currentY += sHeight - (overlap * dpr);
    }

    const blob = await canvas.convertToBlob({ type: fileType, quality });
    return URL.createObjectURL(blob);
}

chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "stitch") return;

    port.onMessage.addListener(async (msg: any) => {
        if (msg.type === "stitch") {
            try {
                const dataUrl = await stitch(msg.plan, msg.tiles, msg.fileType, msg.quality);
                port.postMessage({ type: "stitched", dataUrl });
            } catch (e) {
                console.error("offscreen stitch failed:", e);
                port.postMessage({ type: "error", message: String(e) });
            }
        }
    });
});
