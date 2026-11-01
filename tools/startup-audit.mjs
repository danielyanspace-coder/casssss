/** Размер обязательного графа модулей. Не заменяет сетевой замер в браузере. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

function audit(directory) {
  const root = resolve(directory, 'public');
  const seen = new Map();
  function walk(name) {
    if (seen.has(name)) return;
    const source = readFileSync(resolve(root, name));
    const module = new vm.SourceTextModule(source.toString(), { identifier: name });
    seen.set(name, { file: name, bytes: source.length, gzipLevel1Bytes: gzipSync(source, { level: 1 }).length });
    for (const dependency of module.dependencySpecifiers) {
      if (dependency.startsWith('.')) walk(resolve(root, dirname(name), dependency).slice(root.length + 1));
    }
  }
  walk('app.js');
  const files = [...seen.values()];
  const css = readFileSync(resolve(root, 'styles.css'));
  return {
    directory: resolve(directory),
    staticModules: files.length,
    jsBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    jsGzipLevel1Bytes: files.reduce((sum, f) => sum + f.gzipLevel1Bytes, 0),
    cssBytes: css.length,
    cssGzipLevel1Bytes: gzipSync(css, { level: 1 }).length,
    themeModulesInStartup: files.filter((f) => f.file.startsWith('hd/') && !['hd/kit.js', 'hd/parts.js', 'hd/special.js'].includes(f.file)).map((f) => f.file),
    files: files.map((f) => f.file),
  };
}
for (const directory of process.argv.slice(2).length ? process.argv.slice(2) : ['.']) {
  console.log(JSON.stringify(audit(directory), null, 2));
}
