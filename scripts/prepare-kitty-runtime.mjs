import { cp, mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative, sep } from 'node:path';

// Bundle the exact installed dependency tree and Node binary, not a global runtime.
const root = resolve(import.meta.dirname, '..');
const target = join(root, 'src-tauri/resources/kitty-runtime');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The desktop runtime bundle currently targets Windows x64.');
await mkdir(target, { recursive: true });
await cp(join(root, 'server/kitty'), target, { recursive: true });
await copyFile(process.execPath, join(target, 'node.exe'));
await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'minotes-kitty-runtime', private: true, type: 'module' }));
const seen = new Set();
async function packageDirectory(name, from) {
  const require = createRequire(join(from, 'package.json'));
  let entry;
  try { entry = require.resolve(name + '/package.json'); } catch { entry = require.resolve(name); }
  let folder = dirname(entry);
  while (folder !== dirname(folder)) {
    try { const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')); if (pkg.name === name) return { folder, pkg }; } catch { /* Climb from the entry point. */ }
    folder = dirname(folder);
  }
  throw new Error(`Cannot package ${name}`);
}
async function include(name, from, optional = false) {
  let resolved;
  try { resolved = await packageDirectory(name, from); } catch (error) { if (optional) return; throw error; }
  const { folder, pkg } = resolved;
  if (seen.has(folder)) return; seen.add(folder);
  const subpath = relative(join(root, 'node_modules'), folder);
  if (subpath.startsWith('..' + sep) || subpath === '..') throw new Error('Runtime dependency is outside node_modules.');
  await cp(folder, join(target, 'node_modules', subpath), { recursive: true });
  for (const dependency of Object.keys(pkg.dependencies || {})) await include(dependency, folder);
  for (const dependency of Object.keys(pkg.optionalDependencies || {})) await include(dependency, folder, true);
}
await include('node-llama-cpp', root);
await include('systeminformation', root);
await include('undici', root);
await access(join(target, 'node_modules/node-llama-cpp/dist/index.js'));
console.log(`Kitty runtime prepared with ${seen.size} dependency packages.`);
