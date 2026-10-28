import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 需要固定端口与固定 host，且忽略 src-tauri 的文件监听
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { outDir: "dist", sourcemap: false, target: "chrome110" },
});
