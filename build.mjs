// build.mjs — MV3 build: bundle TS → dist/, copy & fix HTML/manifest paths
import { build } from "esbuild";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import path from "node:path";

const outdir = "dist";
await mkdir(outdir, { recursive: true });

// 1) Бандлим TS → dist/*.js
await build({
    entryPoints: {
        background: "src/background.ts",
        offscreen:  "src/offscreen.ts",
        popup:      "src/popup.ts",
    },
    bundle: true,
    format: "esm",          // SW как ES-модуль
    outdir,
    sourcemap: true,
});

// утилита: правим ссылки на скрипты в HTML, чтобы указывать basename
function fixHtmlScripts(html, map = {}) {
    // map: { "popup.js": /regex/ } — чем заменить
    let s = html;
    for (const [finalName, rx] of Object.entries(map)) {
        s = s.replace(rx, finalName); // например, ../../dist/popup.js → popup.js
    }
    return s;
}

// 2) Копируем и правим popup.html
try {
    const popupHtmlSrc = "popup.html"; // если у тебя лежит в другом месте — поменяй путь
    let html = await readFile(popupHtmlSrc, "utf8");
    html = fixHtmlScripts(html, {
        "popup.js": /\.\.\/.*?dist\/popup\.js|"dist\/popup\.js"|popup\.js/g, // ловим ../../dist/popup.js, "dist/popup.js" и т.п.
    });
    await writeFile(path.join(outdir, "popup.html"), html, "utf8");
} catch (e) {
    console.warn("skip popup.html:", e.message || e);
}

// 3) Копируем (если нужно править — добавь аналогично) offscreen.html
try {
    const offHtmlSrc = "offscreen.html";
    let html = await readFile(offHtmlSrc, "utf8");
    html = fixHtmlScripts(html, {
        "offscreen.js": /\.\.\/.*?dist\/offscreen\.js|"dist\/offscreen\.js"|offscreen\.js/g,
    });
    await writeFile(path.join(outdir, "offscreen.html"), html, "utf8");
} catch (e) {
    console.warn("skip offscreen.html:", e.message || e);
}

// 4) Генерируем manifest.json под «dist как корень»
try {
    const raw = await readFile("manifest.json", "utf8");
    const m = JSON.parse(raw);

    // helper: убираем префикс dist/ и берём basename
    const stripToBasename = (p) =>
        typeof p === "string" ? path.basename(p.replace(/^dist[\\/]/, "")) : p;

    if (m.background?.service_worker) {
        m.background.service_worker = stripToBasename(m.background.service_worker);
    } else {
        // если не указан, ставим по умолчанию на наш бандл
        m.background = { ...(m.background || {}), service_worker: "background.js", type: "module" };
    }

    if (m.action?.default_popup) {
        m.action.default_popup = stripToBasename(m.action.default_popup);
    } else {
        // если попап есть — явно пропишем
        m.action = { ...(m.action || {}), default_popup: "popup.html" };
    }

    // почистим пути в content_scripts (если есть)
    if (Array.isArray(m.content_scripts)) {
        for (const cs of m.content_scripts) {
            if (Array.isArray(cs.js))  cs.js  = cs.js.map(stripToBasename);
            if (Array.isArray(cs.css)) cs.css = cs.css.map(stripToBasename);
        }
    }

    await writeFile(path.join(outdir, "manifest.json"), JSON.stringify(m, null, 2), "utf8");
} catch (e) {
    console.warn("skip manifest.json rewrite:", e.message || e);
}

// 5) (опционально) копируем иконки/прочие ассеты, если есть
try { await cp("icons", path.join(outdir, "icons"), { recursive: true }); } catch {}
console.log("✅ Build complete → dist/");
