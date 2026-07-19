import process from "node:process";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Vite+ 统一配置：Vite 本体 + lint（Oxlint）+ 类型检查（tsgolint）都在这一个文件。
// https://viteplus.dev/
export default defineConfig({
  plugins: [react()],

  // —— Vite options tailored for Tauri development ——
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // —— vp lint / vp check：类型感知 lint + TS 类型检查（tsgo 引擎）——
  lint: {
    ignorePatterns: ["dist/**", "src-tauri/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  // vp check 暂不跑格式化：待全量 oxfmt 格式化单独提交后再开启
  check: {
    fmt: false,
  },
});
