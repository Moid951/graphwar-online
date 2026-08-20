import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/lobby": { target: "ws://127.0.0.1:8080", ws: true },
      "/room": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});