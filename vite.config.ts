import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  base: "./",
  server: { port: 5173, strictPort: true },
  test: {
    include: ["tests/**/*.test.ts"],
    // Career-length tests take a few seconds locally and much longer on CI runners (the bot sweeps regions, AW-220).
    testTimeout: 120_000,
  },
} as import("vite").UserConfig & { test: unknown });
