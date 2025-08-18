# Full Page Saver — TypeScript + MV3
- Service Worker с ES-модулями (`background.type: module`).
- Автопрокрутка → захват `tabs.captureVisibleTab` → offscreen Canvas-сшивка → сохранение через `downloads`.
- Попап с опциями: JPEG/PNG, качество, Save As, скрывать липкие элементы.

## Сборка
```bash
npm i
npm run build
```
Затем загрузить папку как распакованное расширение.

Создано: 2025-08-18T08:57:34
