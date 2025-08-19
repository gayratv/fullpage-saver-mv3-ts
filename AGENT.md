# Gemini Agent Changes

This document summarizes the changes made by the Gemini agent.

The user requested to change the extension's behavior to download individual screenshots instead of a single stitched JPG file.

Here are the changes made to the project:

1.  **`src/background.ts`**:
    *   Removed the logic for stitching tiles together using an offscreen document.
    *   Modified the `runCapture` function to loop through capture positions, and for each position, download the captured image as a separate file.
    *   File names are now generated with a timestamp and a sequence number (e.g., `hostname_title_timestamp_01.jpg`).

2.  **`src/static/manifest.json`**:
    *   Removed the `"offscreen"` permission from the manifest as it is no longer required.

3.  **`build.mjs`**:
    *   Updated the esbuild configuration to remove the entry point for `offscreen.ts`.
    *   Removed the step that processed and copied `offscreen.html`.

4.  **Deleted Files**:
    *   `src/offscreen.ts`
    *   `src/static/offscreen.html`
    *   These files were related to the image stitching functionality which has been removed.

The result is that the extension now captures the full page by scrolling and saving each segment as an individual image file into the user's downloads directory.