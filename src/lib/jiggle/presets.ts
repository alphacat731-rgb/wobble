import type { PhysicsParams } from "@/lib/jiggle/types";

export type Preset = {
  id: string;
  name: string;
  blurb: string;
  params: PhysicsParams;
};

function p(
  elasticity: number,
  stiffness: number,
  damping: number,
  mass: number,
  gravity: number,
  bounce: number,
  deform: number,
  maxDisp: number,
  recovery: number,
): PhysicsParams {
  return { elasticity, stiffness, damping, mass, gravity, bounce, deform, maxDisp, recovery };
}

export const PRESETS: Preset[] = [
  {
    id: "jelly",
    name: "Jelly",
    blurb: "Soft, exaggerated wobble",
    params: p(88, 32, 22, 28, 12, 74, 86, 72, 38),
  },
  {
    id: "rubber",
    name: "Rubber",
    blurb: "Elastic and springy",
    params: p(72, 78, 38, 36, 4, 58, 52, 46, 74),
  },
  {
    id: "water",
    name: "Water",
    blurb: "Fluid, heavy slosh",
    params: p(36, 14, 58, 62, 48, 28, 92, 84, 22),
  },
  {
    id: "balloon",
    name: "Balloon",
    blurb: "Light and bouncy",
    params: p(92, 22, 16, 12, 2, 88, 70, 64, 34),
  },
  {
    id: "gelatin",
    name: "Gelatin",
    blurb: "Very soft, slow oscillations",
    params: p(64, 24, 12, 58, 22, 42, 78, 60, 18),
  },
  {
    id: "squishy",
    name: "Squishy",
    blurb: "Deep squash, quick return",
    params: p(76, 28, 48, 22, 8, 64, 96, 88, 84),
  },
  {
    id: "soft",
    name: "Soft body",
    blurb: "Balanced elasticity",
    params: p(66, 54, 46, 42, 10, 48, 62, 52, 56),
  },
  {
    id: "heavy",
    name: "Heavy",
    blurb: "Slow, weighty movement",
    params: p(38, 68, 70, 94, 36, 22, 40, 34, 28),
  },
  {
    id: "subtle",
    name: "Subtle",
    blurb: "Small, gentle motion",
    params: p(48, 62, 72, 40, 0, 18, 24, 18, 68),
  },
  {
    id: "extreme",
    name: "Extreme",
    blurb: "Highly exaggerated",
    params: p(97, 12, 8, 18, 18, 100, 100, 100, 26),
  },
  {
    id: "slime",
    name: "Slime",
    blurb: "Loose, stretchy motion with a slow settle",
    params: p(94, 18, 32, 30, 14, 82, 100, 90, 22),
  },
  {
    id: "mochi",
    name: "Mochi",
    blurb: "Dense, soft and pillowy",
    params: p(88, 38, 66, 62, 4, 52, 90, 66, 34),
  },
  {
    id: "foam",
    name: "Foam",
    blurb: "Light movement with a cushioned stop",
    params: p(52, 34, 80, 18, 8, 40, 48, 36, 74),
  },
  {
    id: "spring",
    name: "Spring",
    blurb: "Snappy rebound and firm structure",
    params: p(84, 96, 24, 24, 0, 94, 58, 70, 82),
  },
  {
    id: "pudding",
    name: "Pudding",
    blurb: "Heavy wobble with a gentle finish",
    params: p(80, 18, 50, 48, 16, 58, 92, 76, 40),
  },
  {
    id: "fabric",
    name: "Fabric",
    blurb: "Loose folds and flowing movement",
    params: p(46, 58, 54, 34, 12, 32, 76, 48, 62),
  },
  {
    id: "clay",
    name: "Clay",
    blurb: "Firm, restrained deformation",
    params: p(32, 88, 84, 82, 10, 12, 18, 16, 90),
  },
  {
    id: "bubble",
    name: "Bubble",
    blurb: "Very light with a buoyant bounce",
    params: p(98, 16, 14, 8, 0, 98, 84, 96, 20),
  },
  {
    id: "mercury",
    name: "Mercury",
    blurb: "Fast, fluid ripples with a sharp response",
    params: p(58, 42, 14, 72, 32, 66, 82, 72, 18),
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[6]!;
}

export function cloneParams(params: PhysicsParams): PhysicsParams {
  return { ...params };
}
