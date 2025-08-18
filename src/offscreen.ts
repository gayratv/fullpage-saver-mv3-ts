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
  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "stitch") return;
    const { plan, tiles, fileType = "image/jpeg", quality = 0.92 } = msg as {
      plan: Plan; tiles: Tile[]; fileType: string; quality: number;
    };
    try {
      if (!tiles?.length) throw new Error("No tiles");
      const first = await loadImage(tiles[0].dataUrl);
      const tileW = first.width, tileH = first.height;
      const overlapPx = Math.round((plan.overlap / plan.vh) * tileH);
      const totalH = tileH + Math.max(0, (tiles.length - 1)) * (tileH - overlapPx);

      const canvas: HTMLCanvasElement | OffscreenCanvas =
        (typeof OffscreenCanvas !== "undefined")
          ? new OffscreenCanvas(tileW, totalH)
          : Object.assign(document.createElement("canvas"), { width: tileW, height: totalH });

      const ctx = (canvas as any).getContext("2d")!;

      let yDraw = 0;
      for (let i = 0; i < tiles.length; i++) {
        const img = i === 0 ? first : await loadImage(tiles[i].dataUrl);
        if (i === 0) { ctx.drawImage(img, 0, 0); yDraw = tileH; }
        else { ctx.drawImage(img, 0, yDraw - overlapPx); yDraw += tileH - overlapPx; }
      }

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
      port.postMessage({ type: "stitched", dataUrl });
    } catch (e: any) {
      console.error("Stitch error", e);
      port.postMessage({ type: "error", message: String(e) });
    }
  });
});
