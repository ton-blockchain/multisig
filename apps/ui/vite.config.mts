import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    target: "esnext",
    outDir: "build",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "~": resolve(__dirname, "./src"),
      src: resolve(__dirname, "./src"),
    },
  },
});
