export type PhysicsParams = {
  elasticity: number;
  stiffness: number;
  damping: number;
  mass: number;
  gravity: number;
  bounce: number;
  deform: number;
  maxDisp: number;
  recovery: number;
};

export type RegionMeta = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  params: PhysicsParams;
};

export type ToolId =
  | "soft"
  | "hard"
  | "eraser"
  | "polygon"
  | "lasso"
  | "fill"
  | "pan"
  | "interact"
  | "jiggle"
  | "push"
  | "pull"
  | "smooth"
  | "freeze"
  | "restore";

export type BrushSettings = {
  size: number;
  strength: number;
  softness: number;
  opacity: number;
  additive: boolean;
  tolerance: number;
};

export type ToolMode = "select" | "play";

export const SELECT_TOOLS: ToolId[] = ["soft", "hard", "eraser", "polygon", "lasso", "fill"];
export const SCULPT_TOOLS: ToolId[] = ["jiggle", "push", "pull", "smooth", "freeze", "restore"];

export function toolMode(tool: ToolId): ToolMode {
  if (tool === "interact" || SCULPT_TOOLS.includes(tool)) return "play";
  return "select";
}

export function defaultBrush(): BrushSettings {
  return {
    size: 56,
    strength: 78,
    softness: 62,
    opacity: 52,
    additive: true,
    tolerance: 36,
  };
}

export const REGION_COLORS = [
  "#ff7a45",
  "#3ee0b0",
  "#7aa2ff",
  "#ffd166",
  "#f472b6",
  "#c084fc",
  "#67e8f9",
  "#bef264",
];

export type EngineStatus = {
  hasImage: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  zoom: number;
  width: number;
  height: number;
};

export type ProjectRegion = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  params: PhysicsParams;
  mask: string;
  freeze: string;
};

export type ProjectFile = {
  version: 1;
  app: "wobble";
  image: string;
  activeId: string | null;
  quality: number;
  shake: number;
  opacity: number;
  overlay: boolean;
  regions: ProjectRegion[];
};

export type CustomPreset = {
  id: string;
  name: string;
  params: PhysicsParams;
};
