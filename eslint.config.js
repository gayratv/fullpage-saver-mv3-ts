// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import globals from "globals"; // <-- ИМПОРТИРУЕМ GLOBALS

// Общие игноры
const ignores = ["dist/**", "node_modules/**"];

export default defineConfig([
    { ignores },

    // --- ДОБАВЛЕН НОВЫЙ БЛОК ДЛЯ NODE.JS ФАЙЛОВ ---
    {
        files: ["build.mjs", "eslint.config.js"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    // ---------------------------------------------

    // Базовые правила JS
    js.configs.recommended,

    // TypeScript: парсер+плагины и рекомендуемые наборы правил
    ...tseslint.configs.recommended,

    // Специфика окружений MV3
    {
        files: ["src/background.ts", "dist/background.js"],
        languageOptions: {
            globals: { chrome: "readonly" },
        },
        linterOptions: { reportUnusedDisableDirectives: true },
    },
    {
        files: ["src/popup.ts", "dist/popup.js"],
        languageOptions: {
            globals: { chrome: "readonly", window: "readonly", document: "readonly" },
        },
    },

    // Кастомные правила на твой вкус
    {
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-console": ["warn", { allow: ["warn", "error"] }],
            "@typescript-eslint/no-explicit-any": "off",
            "no-empty": "off"
        },
    },
]);
