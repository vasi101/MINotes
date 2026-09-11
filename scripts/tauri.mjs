import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
const cargoBin = join(
  process.env.CARGO_HOME || join(homedir(), ".cargo"),
  "bin",
);
const env = { ...process.env };
if (existsSync(cargoBin)) {
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] =
    cargoBin +
    (process.platform === "win32" ? ";" : ":") +
    (env[pathKey] || "");
}
const child = spawn(
  process.execPath,
  ["node_modules/@tauri-apps/cli/tauri.js", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
