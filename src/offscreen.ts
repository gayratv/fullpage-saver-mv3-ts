// src/offscreen.ts
/* global OffscreenCanvas */

import type { Plan, Tile } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
    });
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "stitch") return;
    // eslint-disable-next-line no-console
    console.debug("offscreen connected");
    port.onMessage.addListener(async (msg) => {
        if (msg?.type !== "stitch") return;
        // eslint-disable-next-line no-console
        console.debug("offscreen received", { tiles: msg.tiles?.length });
        const { plan, tiles, fileType = "image/jpeg", quality = 0.92 } = msg as {
            plan: Plan; tiles: Tile[]; fileType: string; quality: number;
        };
        try {
            if (!tiles?.length) throw new Error("No tiles");
            const first = await loadImage(tiles[0].dataUrl);
            const tileW = first.width, tileH = first.height;

            // --- НАЧАЛО ИЗМЕНЕНИЙ ---

            // 1. Создаем холст точного размера страницы в пикселях
            const totalH = Math.round(plan.sh * plan.dpr);
            const overlapPx = Math.round((plan.overlap / plan.vh) * tileH);

            const canvas: HTMLCanvasElement | OffscreenCanvas =
                (typeof OffscreenCanvas !== "undefined")
                    ? new OffscreenCanvas(tileW, totalH)
                    : Object.assign(document.createElement("canvas"), { width: tileW, height: totalH });

            const ctx = (canvas as any).getContext("2d")!;

            let yDraw = 0; // Текущая позиция для отрисовки на холсте
            for (let i = 0; i < tiles.length; i++) {
                const img = i === 0 ? first : await loadImage(tiles[i].dataUrl);
                const yOnCanvas = i === 0 ? 0 : yDraw - overlapPx;

                // 2. Для последнего фрагмента обрезаем его, чтобы он не выходил за границы холста
                if (i === tiles.length - 1) {
                    const remainingHeight = totalH - yOnCanvas;
                    if (remainingHeight < tileH) {
                        // Отрисовываем только необходимую верхнюю часть последнего снимка
                        ctx.drawImage(img, 0, 0, tileW, remainingHeight, 0, yOnCanvas, tileW, remainingHeight);
                    } else {
                        ctx.drawImage(img, 0, yOnCanvas);
                    }
                } else {
                    ctx.drawImage(img, 0, yOnCanvas);
                }
                yDraw += tileH - overlapPx;
            }

            // --- КОНЕЦ ИЗМЕНЕНИЙ ---

            async function toDataURLFromCanvas(cnv: any, type: string, q: number): Promise<string> {
                if (cnv.convertToBlob) {
                    const blob = await cnv.convertToBlob({ type, quality: q });
                    const fr = new FileReader();
                    return await new Promise<string>((resolve) => {
                        fr.onload = () => resolve(fr.result as string);
                        fr.readAsDataURL(blob);
                    });
                } else {
                    return cnv.toDataURL(type, q);
                }
            }

            const dataUrl = await toDataURLFromCanvas(canvas, fileType, quality);
            // eslint-disable-next-line no-console
            console.debug("offscreen stitched", { length: dataUrl.length });
            port.postMessage({ type: "stitched", dataUrl });
        } catch (e: any) {
            console.error("Stitch error", e);
            port.postMessage({ type: "error", message: String(e) });
        }
    });
});