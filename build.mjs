// build.mjs
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp } from 'fs/promises';
import path from 'node:path';
import copy from 'esbuild-plugin-copy'; // esbuild-plugin-copy

const outdir = 'dist';

// 1) Бандлим ts -> dist/*.js
await build({
    entryPoints: {
        background: 'src/background.ts',
        offscreen:  'src/offscreen.ts',
        popup:      'src/popup.ts',
    },
    bundle: true,
    format: 'esm',
    outdir,
    sourcemap: true,
    plugins: [
        copy({
            assets: [
                { from: 'src/static/popup.html',    to: '.' },
                { from: 'src/static/offscreen.html',to: '.' },
            ],
            verbose: true
        })
    ]
});

// 2) Генерируем manifest.json с корректными путями под «dist как корень»
const raw = await readFile('src/static/manifest.json', 'utf8');
const manifest = JSON.parse(raw);

// Если вдруг в исходном манифесте есть пути вида "dist/...", убираем префикс.
function stripDist(p) {
    return typeof p === 'string' ? p.replace(/^dist\//, '') : p;
}
if (manifest.background?.service_worker) {
    manifest.background.service_worker = stripDist(manifest.background.service_worker);
}
// Если используешь "action.default_popup" укажи просто "popup.html"
if (manifest.action?.default_popup) {
    manifest.action.default_popup = path.basename(manifest.action.default_popup);
}
// Offscreen URL (если указан в коде chrome.offscreen.createDocument)
if (manifest.web_accessible_resources) {
    // обычно offscreen.html НЕ требуется объявлять как WAR; пропусти
}

// 3) Записываем манифест в dist/
await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 4) (опционально) копируем README/иконки
await mkdir(outdir, { recursive: true });
try { await cp('README.md', path.join(outdir, 'README.md')); } catch {}
console.log('Build complete → dist/');
