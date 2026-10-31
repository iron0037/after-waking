import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  base: "./",
  server: { port: 5173, strictPort: true },
  test: {
    include: ["tests/**/*.test.ts"],
    // Career-length tests take a few seconds locally and longer on CI runners.
    testTimeout: 30_000,
  },
} as import("vite").UserConfig & { test: unknown });
