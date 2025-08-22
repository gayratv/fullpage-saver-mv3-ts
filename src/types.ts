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

export type DebugLogResponse = {
    type: "debug_log";
    message?: string;
};

export type DebugFrameResponse = {
    type: "debug_frame";
    dataUrl?: string;
    frameIndex?: number;
};

// В сообщения, приходящие В background.ts из offscreen.ts (incoming):
export type OffscreenIncoming =
    | StitchedResponse
    | ErrorResponse
    | DebugLogResponse
    | DebugFrameResponse;

// Сообщение, которое background.ts отправляет В offscreen.ts (outgoing):
export type OffscreenRequest = StitchRequest;