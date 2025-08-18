/**
 * Эта функция будет внедряться на веб-страницу для поиска целевого элемента.
 * Она не должна иметь зависимостей от других модулей.
 */
function findTargetElement() {
    // Используем console.log для отладки прямо на странице
    const container = document.querySelector('#page-container');
    if (!container) {
        console.log('ОТЛАДКА: Контейнер #page-container НЕ НАЙДЕН.');
        return null;
    }

    // --- НАЧАЛО ИЗМЕНЕНИЙ ---
    // Ищем дочерний элемент с классом 'tocwrapper'
    const targetEl = container.querySelector('.tocwrapper');
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    if (!targetEl) {
        console.log('ОТЛАДКА: Дочерний элемент .tocwrapper НЕ НАЙДЕН внутри #page-container.');
        return null;
    }

    const rect = targetEl.getBoundingClientRect();
    const metrics = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        // Дополнительная информация для отладки
        tagName: targetEl.tagName,
        className: targetEl.className,
        id: targetEl.id
    };
    console.log('ОТЛАДКА: Целевой элемент найден. Его метрики:', metrics);
    return metrics;
}
