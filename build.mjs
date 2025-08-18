// build.mjs — сборка MV3 (TS → dist, статика из src/static → dist с автоправкой путей)
import { build } from "esbuild";
import {  mkdir } from "node:fs/promises";

const outdir = "dist";
await mkdir(outdir, { recursive: true });

// 1) Бандлим TS → dist/*.js
await build({
    entryPoints: {
        background: "src/background.ts",
        // offscreen:  "src/offscreen.ts", // <-- УДАЛИТЕ ЭТУ СТРОКУ
        popup:      "src/popup.ts",
    },
    bundle: true,
    format: "esm",
    outdir,
    sourcemap: true,
});

// утилита: фиксим ссылки на скрипты в HTML
function fixHtmlScripts(html, map = {}) {
    // ... (остальной код без изменений)
}

// 2) popup.html
// ... (без изменений)

// 3) offscreen.html // <-- ВЕСЬ ЭТОТ БЛОК МОЖНО УДАЛИТЬ
/*
{
    const offHtmlSrc = "src/static/offscreen.html";
    let html = await readFile(offHtmlSrc, "utf8");
    html = fixHtmlScripts(html, {
        "offscreen.js": /\.\.\/.*?dist\/offscreen\.js|"dist\/offscreen\.js"|offscreen\.js/g,
    });
    await writeFile(path.join(outdir, "offscreen.html"), html, "utf8");
}
*/

// 4) manifest.json → правим пути
// ... (остальной код без изменений)