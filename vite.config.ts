import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  base: "./",
  server: { port: 5173, strictPort: true },
  test: {
    include: ["tests/**/*.test.ts"],
  },
} as import("vite").UserConfig & { test: unknown });
