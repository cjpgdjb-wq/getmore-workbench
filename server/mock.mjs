/**
 * Bundles src/data/mock.ts (the single source of truth for demo data) and
 * exposes it to the Node orchestration runtime, so工具查询的数值与前端看板一致。
 *
 * 运行环境不允许 spawn 子进程（例如受限沙箱）时，esbuild 的 service 起不来；
 * 因此优先使用预打包产物 .runtime/mock.bundle.mjs（由 scripts/build-mock-bundle.mjs 生成）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src", "data", "mock.ts");
const BUNDLE = path.join(ROOT, ".runtime", "mock.bundle.mjs");
let cached = null;

function bundleIsFresh() {
  try {
    return fs.statSync(BUNDLE).mtimeMs >= fs.statSync(SOURCE).mtimeMs;
  } catch {
    return false;
  }
}

export async function loadMock() {
  // 评测需要跨天可复现：脚本可设 MOCK_TODAY=YYYY-MM-DD 冻结数据日期。
  if (process.env.MOCK_TODAY) globalThis.__MOCK_TODAY__ = process.env.MOCK_TODAY;
  if (cached) return cached;

  if (bundleIsFresh()) {
    cached = await import(pathToFileURL(BUNDLE).href);
    return cached;
  }

  const { build } = await import("esbuild");
  let code;
  try {
    const result = await build({
      entryPoints: [SOURCE],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      write: false,
    });
    code = result.outputFiles[0].text;
    fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
    fs.writeFileSync(BUNDLE, code, "utf8");
  } catch (error) {
    // 受限环境无法 spawn esbuild 时，退回已有的预打包产物（可能略旧）。
    if (fs.existsSync(BUNDLE)) {
      console.warn(`[mock] esbuild 不可用，使用已有预打包产物：${error instanceof Error ? error.message : error}`);
      cached = await import(pathToFileURL(BUNDLE).href);
      return cached;
    }
    throw error;
  }
  cached = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  return cached;
}
