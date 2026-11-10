import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src", "data", "mock.ts");
const OUT = path.join(ROOT, ".runtime", "mock.bundle.mjs");

const candidates = [
  path.join(ROOT, "node_modules", "@esbuild", "win32-x64", "esbuild.exe"),
  path.join(ROOT, "node_modules", ".pnpm", "esbuild@0.28.2", "node_modules", "@esbuild", "win32-x64", "esbuild.exe"),
];
const binary = candidates.find((file) => fs.existsSync(file));
if (!binary) {
  console.error("找不到 esbuild 二进制；请先在可 spawn 的终端运行一次 pnpm qa:llm-rubric。");
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(
  binary,
  [SOURCE, "--bundle", "--format=esm", "--platform=node", "--target=node20", `--outfile=${OUT}`],
  { stdio: "inherit" },
);
console.log(`mock bundle -> ${path.relative(ROOT, OUT)}`);
