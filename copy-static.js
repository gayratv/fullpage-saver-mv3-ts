// copy-static.js
import { cp } from 'fs/promises';

async function copy() {
    await cp('src/manifest.json', 'dist/manifest.json');
    await cp('src/popup.html', 'dist/popup.html');
    await cp('src/offscreen.html', 'dist/offscreen.html');
    await cp('README.md', 'dist/README.md');
}
copy().catch(console.error);
