// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

// Общие игноры
const ignores = ["dist/**", "node_modules/**"];

export default defineConfig([
    { ignores },

    // Базовые правила JS
    js.configs.recommended,

    // TypeScript: парсер+плагины и рекомендуемые наборы правил
    // первый блок без type-checking (быстрее),
    // второй — с type-checking (если укажешь project)
    ...tseslint.configs.recommended,

    // Если хочешь правила с type-checking, раскомментируй блок ниже и укажи tsconfig.path:
    // {
    //   files: ["**/*.ts", "**/*.tsx"],
    //   languageOptions: {
    //     parserOptions: {
    //       project: "./tsconfig.json",     // важно: реальный путь к tsconfig
    //     },
    //   },
    //   plugins: {
    //     "@typescript-eslint": tseslint.plugin,
    //   },
    //   rules: {
    //     // дополнительные «строгие» типовые правила
    //   },
    // },

    // Специфика окружений MV3
    {
        files: ["src/background.ts", "dist/background.js"],
        languageOptions: {
            // сервис-воркер — это web worker
            globals: { chrome: "readonly" }, // типы уже есть через @types/chrome
        },
        linterOptions: { reportUnusedDisableDirectives: true },
    },
    {
        files: ["src/offscreen.ts", "src/popup.ts", "dist/offscreen.js", "dist/popup.js"],
        languageOptions: {
            // offscreen/popup — это «браузерное» DOM-окружение
            globals: { chrome: "readonly", window: "readonly", document: "readonly" },
        },
    },

    // Кастомные правила на твой вкус
    {
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-console": ["warn", { allow: ["warn", "error"] }],
            "@typescript-eslint/no-explicit-any": "off"
        },
    },
]);
