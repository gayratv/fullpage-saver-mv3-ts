// src/types.ts — общие типы для background.ts и offscreen.ts

export type CaptureFormat = "jpeg" | "png";

export interface Plan {
    dpr: number;
    vw: number;
    vh: number;
    sw: number;
    sh: number;
    overlap: number;
    step: number;
    stops: number[];
}

export interface Tile {
    y: number;
    dataUrl: string;
}

export interface StartOpts {
    format: CaptureFormat;
    quality: number; // 0..1 (ignored for PNG)
    saveAs: boolean;
    hideSticky: boolean;
}
