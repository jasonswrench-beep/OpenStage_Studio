import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    // Rust's build folders are locked while compiling, so Vite must not watch them.
    watch: { ignored: ["**/src-tauri/**", "**/studio-helper/**", "**/work/**"] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    // Two pages: the app, and the practice program it records for tests and examples.
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sample: resolve(__dirname, "sample.html"),
      },
    },
  },
});
