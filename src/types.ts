// src/types.ts — общие типы для background.ts и offscreen.ts

export type CaptureFormat = "jpeg" | "png";

export interface Plan {
    dpr: number;
    vw: number; // innerWidth
    innerWidth: number;
    innerHeight: number;
    vh: number;
    sw: number;
    sh: number;
    overlap: number;
    step: number;
    stops: number[];
    headerHeight: number;
    lastPosCorrection: number;
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

// === Offscreen messaging (stitch) ===

export type StitchRequest = {
    type: "stitch";
    plan: Plan;
    tiles: Tile[];
    fileType: string;   // e.g. "image/png" | "image/jpeg" | "image/webp"
    quality: number;    // 0..1 для JPEG/WEBP; для PNG игнорируется
    drawCroppedImage: boolean; // отрисовывать и выводить CroppedImage
};

export type StitchedResponse = {
    type: "stitched";
    dataUrl: string;
};

export type ErrorResponse = {
    type: "error";
    message: string;
};

// Сообщение, которое ПРИХОДИТ снаружи в offscreen.ts
export type OffscreenRequest = StitchRequest;


// Сообщение, которое МЫ отправляем наружу из offscreen.ts
export type SaveCroppedImage = {
    type: "debug_frame";
    dataUrl: string;
    frameIndex: number
};

export type DebugLog = {
    type: "debug_log";
    message: string;
};


// Сообщение, которое МЫ отправляем наружу из offscreen.ts
export type OffscreenResponse = StitchedResponse | ErrorResponse;

// background.ts
// port.onMessage.addListener((msg: BackgroundListenersMSG) => {
export type BackgroundListenersMSG = SaveCroppedImage | StitchedResponse | ErrorResponse | DebugLog;
