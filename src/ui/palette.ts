/** Shared colors for the maps. Kept in one place so every screen reads as one game. */
import type { BodyKind } from "../sim";

export const UI = {
  space: "#05070f",
  grid: "#16213a",
  gridBright: "#22355a",
  text: "#d7e3f4",
  muted: "#7f8fa8",
  accent: "#ffb347",
  cyan: "#5fd4ff",
  good: "#7ee787",
  danger: "#ff6b6b",
  ship: "#ffe08a",
  intrepid: "#9fe8ff",
} as const;

export const BODY_COLOR: Record<BodyKind, string> = {
  asteroid: "#8a7f74",
  barren: "#a39a90",
  desert: "#d9a76a",
  terrestrial: "#6fae6a",
  ocean: "#3d7fd6",
  ice: "#cfeaff",
  hothouse: "#e8c15a",
  volcanic: "#d2553b",
  gasGiant: "#d9b48a",
  iceGiant: "#7fc6e0",
};

/** Surface terrain colors per body kind: [plain, rough, mountain, ice, liquid, lava]. */
export const TERRAIN_COLORS: Record<BodyKind, readonly [string, string, string, string, string, string]> = {
  asteroid: ["#6f665e", "#5a524b", "#423c37", "#9fb4c4", "#2a4d78", "#c4462a"],
  barren: ["#8f877e", "#756e66", "#56504a", "#b9cfde", "#2a4d78", "#c4462a"],
  desert: ["#c99a5e", "#a97c47", "#7d5a35", "#d7e8f2", "#2f6aa8", "#c4462a"],
  terrestrial: ["#5e9a55", "#4a7d43", "#6e6a5e", "#e3f1fa", "#2c62b0", "#c4462a"],
  ocean: ["#6aa36a", "#55854f", "#77736a", "#e3f1fa", "#24539c", "#c4462a"],
  ice: ["#cfe4f2", "#a9c6da", "#8aa6bc", "#dff0fb", "#3a6c9a", "#c4462a"],
  hothouse: ["#c9a24e", "#a8843c", "#7a5f2c", "#e3d9b0", "#7a6a1c", "#e05a2a"],
  volcanic: ["#5a4a44", "#463833", "#2f2522", "#a8b8c4", "#2a4d78", "#ff6a2a"],
  gasGiant: ["#000", "#000", "#000", "#000", "#000", "#000"],
  iceGiant: ["#000", "#000", "#000", "#000", "#000", "#000"],
};
