/**
 * Клиент собирается браузером, а не сборщиком, и до сих пор его никто не
 * разбирал: тесты интерфейса ходят в демо-сборку, а она вырезает строки
 * import регулярным выражением. Из-за этого в public/app.js полгода могла
 * лежать лишняя запятая в списке импортов - демо собиралось, а настоящее
 * приложение не загружалось вовсе.
 *
 * Эта проверка разбирает каждый модуль клиента как модуль и сверяет, что
 * всё, что один файл импортирует, другой действительно экспортирует.
 * Браузер падает на таком молча, в консоли, и увидеть это можно только
 * открыв приложение.
 */
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, resolve as resolvePath, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolvePath(ROOT, 'public');

if (typeof vm.SourceTextModule !== 'function') {
  console.error('Запускать через: node --experimental-vm-modules test/modules.mjs');
  process.exit(1);
}

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) return;
  failures++;
  console.error(`  ПРОВАЛ: ${name}${detail ? ' - ' + detail : ''}`);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const modules = new Map();

// 1. Разбор. Синтаксическая ошибка в любом файле - приложение не стартует.
for (const file of files) {
  const source = readFileSync(resolvePath(DIR, file), 'utf8');
  try {
    modules.set(file, { source, mod: new vm.SourceTextModule(source, { identifier: file }) });
  } catch (e) {
    failures++;
    console.error(`  ПРОВАЛ: ${file} не разбирается как модуль - ${e.message}`);
  }
}

// 2. Экспорты каждого файла. Читаем объявления, а не исполняем: исполнение
//    требует DOM, которого здесь нет.
const exportsOf = new Map();
for (const [file, { source }] of modules) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // export { a, b as c }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const as = piece.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  exportsOf.set(file, names);
}

// 3. Импорты: каждое имя обязано найтись в экспортах того файла.
for (const [file, { source }] of modules) {
  for (const m of source.matchAll(/^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';/gm)) {
    const target = m[2];
    if (!target.startsWith('.')) continue;
    const rel = relative(DIR, resolvePath(DIR, target));
    check(`${file}: модуль ${target} существует`, modules.has(rel), 'файла нет');
    if (!modules.has(rel)) continue;
    // Последний элемент пустой у любого списка с висячей запятой - это
    // законно. Пустой в середине - та самая лишняя запятая, на которой
    // приложение не грузится.
    const parts = m[1].split(',');
    if (parts.length && !parts[parts.length - 1].trim()) parts.pop();
    for (const part of parts) {
      const piece = part.trim();
      if (!piece) {
        check(`${file}: в списке импортов из ${target} нет пустых элементов`, false,
              'лишняя запятая');
        continue;
      }
      const name = piece.split(/\s+as\s+/)[0].trim();
      check(`${file}: ${target} экспортирует ${name}`,
            exportsOf.get(rel).has(name));
    }
  }
}

// 4. Пути к картинкам в коде обязаны быть целыми строками: автономная сборка
//    заменяет '/assets/ui/что-то.webp' на сам файл и склейку в шаблоне
//    не видит.
for (const [file, { source }] of modules) {
  for (const m of source.matchAll(/\/assets\/ui\/\$\{/g)) {
    check(`${file}: путь к картинке не склеен в шаблоне`, false, m[0]);
  }
}

if (failures) {
  console.error(`\nМодули клиента: провалов - ${failures}\n`);
  process.exit(1);
}
console.log(`Модули клиента: ${files.length} файлов, импорты сходятся`);
