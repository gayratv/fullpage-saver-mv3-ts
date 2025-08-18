import { build } from 'esbuild';
import copy from 'esbuild-plugin-copy';

await build({
    entryPoints: { background: 'src/background.ts', popup: 'src/popup.ts', offscreen: 'src/offscreen.ts' },
    bundle: true,
    outdir: 'dist',
    plugins: [
        copy({
            assets: [
                { from: 'src/manifest.json', to: '.' },
                { from: 'src/popup.html', to: '.' },
                { from: 'src/offscreen.html', to: '.' },
                { from: 'README.md', to: '.' }
            ],
            copyOnStart: true,
            verbose: true
        })
    ]
});
