// build.mjs — сборка MV3 (TS → dist, статика из src/static → dist с автоправкой путей)
import { build } from "esbuild";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import path from "node:path";

const outdir = "dist";
await mkdir(outdir, { recursive: true });

// 1) Бандлим фоновый скрипт (обязательно как ES Module)
await build({
    entryPoints: {
        background: "src/background.ts",
    },
    bundle: true,
    format: "esm",
    outdir,
    sourcemap: true,
});

// 2) Бандлим скрипты для popup и offscreen (как IIFE)
await build({
    entryPoints: {
        popup: "src/popup.ts",
        offscreen: "src/offscreen.ts",
    },
    bundle: true,
    format: "iife",
    outdir,
    sourcemap: true,
});


// утилита: фиксим ссылки на скрипты в HTML
function fixHtmlScripts(html, map = {}) {
    let s = html;
    for (const [finalName, rx] of Object.entries(map)) {
        s = s.replace(rx, finalName);
    }
    return s;
}

// 3) popup.html
{
    const popupHtmlSrc = "src/static/popup.html";
    let html = await readFile(popupHtmlSrc, "utf8");
    html = fixHtmlScripts(html, {
        "popup.js": /\.\.\/.*?dist\/popup\.js|"dist\/popup\.js"|popup\.js/g,
    });
    await writeFile(path.join(outdir, "popup.html"), html, "utf8");
}

// 4) offscreen.html
{
    const offHtmlSrc = "src/static/offscreen.html";
    let html = await readFile(offHtmlSrc, "utf8");
    html = fixHtmlScripts(html, {
        "offscreen.js": /\.\.\/.*?dist\/offscreen\.js|"dist\/offscreen\.js"|offscreen\.js/g,
    });
    await writeFile(path.join(outdir, "offscreen.html"), html, "utf8");
}


// 5) manifest.json → правим пути
{
    const raw = await readFile("src/static/manifest.json", "utf8");
    const m = JSON.parse(raw);

    const stripToBasename = (p) =>
        typeof p === "string" ? path.basename(p.replace(/^dist[\\/]/, "")) : p;

    if (m.background?.service_worker) {
        m.background.service_worker = stripToBasename(m.background.service_worker);
    } else {
        m.background = { ...(m.background || {}), service_worker: "background.js", type: "module" };
    }

    if (m.action?.default_popup) {
        m.action.default_popup = stripToBasename(m.action.default_popup);
    } else {
        m.action = { ...(m.action || {}), default_popup: "popup.html" };
    }

    await writeFile(path.join(outdir, "manifest.json"), JSON.stringify(m, null, 2), "utf8");
}

// 6) (опционально) иконки/ассеты
try { await cp("src/static/icons", path.join(outdir, "icons"), { recursive: true }); } catch {}

console.log("✅ Build complete → dist/");
