import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const root = join(import.meta.dirname, "../src-tauri/target/release/bundle");
const output = join(import.meta.dirname, "../release-assets");
const platformFormats = {
  win32: [".exe", ".msi"],
  darwin: [".dmg"],
  linux: [".deb", ".AppImage"],
};
const expected = platformFormats[process.platform];
if (!expected)
  throw new Error(`Unsupported release platform: ${process.platform}`);
await mkdir(output, { recursive: true });

async function findFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await findFiles(path)));
    else if (expected.some((extension) => entry.name.endsWith(extension)))
      found.push(path);
  }
  return found;
}

const files = await findFiles(root);
const foundFormats = new Set();
for (const source of files) {
  const name = basename(source);
  await cp(source, join(output, name));
  for (const extension of expected)
    if (name.endsWith(extension)) foundFormats.add(extension);
}
const missing = expected.filter((extension) => !foundFormats.has(extension));
if (missing.length)
  throw new Error(
    `Release bundles missing on ${process.platform}: ${missing.join(", ")}`,
  );

const checksums = [];
for (const name of (await readdir(output))
  .filter((name) => name !== "SHA256SUMS.txt")
  .sort()) {
  const data = await readFile(join(output, name));
  checksums.push(`${createHash("sha256").update(data).digest("hex")}  ${name}`);
}
await writeFile(join(output, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
console.log(
  `Collected ${files.length} ${process.platform} installer(s) and wrote checksums.`,
);
