import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端通过 Vite 代理访问本地 nanobot 网关，避免浏览器 CORS 限制。
const NANOBOT_API = process.env.NANOBOT_API_URL ?? "http://127.0.0.1:8900";
const PARTNER_API = process.env.PARTNER_URL ?? "http://127.0.0.1:5180";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/shots/**", "**/.runtime/**"],
    },
    proxy: {
      "/partner": {
        target: PARTNER_API,
        changeOrigin: true,
      },
      "/webui": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
      "/nanobot-api": {
        target: NANOBOT_API,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nanobot-api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
