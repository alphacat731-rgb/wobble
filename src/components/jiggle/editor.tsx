import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Slider from "@radix-ui/react-slider";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Blend,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileJson,
  Film,
  FolderOpen,
  Hand,
  ImagePlus,
  Lasso,
  Magnet,
  Move,
  PaintBucket,
  Pause,
  PenLine,
  Pentagon,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scan,
  SlidersHorizontal,
  Snowflake,
  Trash2,
  Undo2,
  Upload,
  Vibrate,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
  Brush,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import gummyUrl from "@/assets/gummy.jpg";
import { cn } from "@/lib/cn";
import { JiggleEngine } from "@/lib/jiggle/engine";
import { cloneParams, PRESETS, presetById } from "@/lib/jiggle/presets";
import { clearSession, loadCustomPresets, loadSession, saveCustomPresets, saveSession } from "@/lib/jiggle/storage";
import {
  defaultBrush,
  REGION_COLORS,
  toolMode,
  type BrushSettings,
  type CustomPreset,
  type EngineStatus,
  type PhysicsParams,
  type ProjectFile,
  type RegionMeta,
  type ToolId,
} from "@/lib/jiggle/types";

type QaApi = {
  loadSample: () => Promise<void>;
  exercise: () => unknown;
  debug: () => unknown;
};

declare global {
  interface Window {
    __wobble?: QaApi;
  }
}

const emptyStatus: EngineStatus = {
  hasImage: false,
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  zoom: 1,
  width: 0,
  height: 0,
};

function makeRegion(n: number, params: PhysicsParams, name?: string): RegionMeta {
  return {
    id: crypto.randomUUID(),
    name: name ?? `Region ${n}`,
    color: REGION_COLORS[(n - 1) % REGION_COLORS.length]!,
    visible: true,
    params: cloneParams(params),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<JiggleEngine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const apiRef = useRef<QaApi>({
    loadSample: async () => {},
    exercise: () => null,
    debug: () => null,
  });

  const [tool, setTool] = useState<ToolId>("soft");
  const [brush, setBrush] = useState<BrushSettings>(defaultBrush);
  const [regions, setRegions] = useState<RegionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<EngineStatus>(emptyStatus);
  const [imageOn, setImageOn] = useState(false);
  const [quality, setQuality] = useState(46);
  const [shake, setShake] = useState(55);
  const [overlay, setOverlay] = useState(true);
  const [showMesh, setShowMesh] = useState(false);
  const [paused, setPaused] = useState(false);
  const [presetId, setPresetId] = useState<string>("jelly");
  const [custom, setCustom] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [sheet, setSheet] = useState<"tools" | "physics" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [motion, setMotion] = useState<"off" | "on" | "denied">("off");
  const [leftW, setLeftW] = useState(240);
  const [rightW, setRightW] = useState(300);
  const [dragOver, setDragOver] = useState(false);

  const active = regions.find((region) => region.id === activeId) ?? null;
  const mode = toolMode(tool);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlayCanvas = overlayRef.current;
    if (!canvas || !overlayCanvas) return;
    const engine = new JiggleEngine(canvas, overlayCanvas);
    engineRef.current = engine;
    engine.tool = tool;
    engine.brush = brush;
    engine.overlay = overlay;
    engine.showMesh = showMesh;
    engine.paused = paused;
    engine.shakeSensitivity = shake;
    engine.onChange = (next) => setStatus(next);
    engine.onProject = (project, metas) => {
      setRegions(metas);
      setActiveId(project.activeId && metas.some((region) => region.id === project.activeId) ? project.activeId : metas[0]?.id ?? null);
      setQuality(project.quality || 46);
      setShake(project.shake ?? 55);
      setOverlay(project.overlay !== false);
      setBrush((current) => ({ ...current, opacity: project.opacity ?? current.opacity }));
      setImageOn(true);
      setTool("interact");
    };
    window.__wobble = {
      loadSample: () => apiRef.current.loadSample(),
      exercise: () => engine.exercise(),
      debug: () => engine.debug(),
    };
    setCustom(loadCustomPresets());
    void loadSession()
      .then((project) => setHasSession(Boolean(project)))
      .catch(() => setHasSession(false));
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // Engine is created once. Later effects push tool/brush/region changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.syncRegions(regions, activeId);
  }, [regions, activeId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.tool = tool;
    if (tool !== "polygon" && tool !== "lasso") engine.cancelShape();
  }, [tool]);

  useEffect(() => {
    engineRef.current?.setBrush(brush);
  }, [brush]);

  useEffect(() => {
    engineRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.overlay = overlay;
    engine.showMesh = showMesh;
    engine.paused = paused;
    engine.shakeSensitivity = shake;
  }, [overlay, showMesh, paused, shake]);

  useEffect(() => {
    if (!imageOn) return;
    const handle = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      void engine
        .toProject({ quality, shake, opacity: brush.opacity, overlay })
        .then((project) => {
          if (project.image.length > 14_000_000) return;
          return saveSession(project);
        })
        .then(() => setHasSession(true))
        .catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [imageOn, regions, activeId, quality, shake, overlay, brush.opacity, status.canUndo]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const engine = engineRef.current;
      if (!engine) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) engine.redo();
        else engine.undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        engine.redo();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        engine.space = true;
        return;
      }
      if (event.key === "Enter") engine.closePolygon();
      if (event.key === "Escape") {
        engine.cancelShape();
        setSheet(null);
        setExportOpen(false);
      }
      if (event.key === "[") setBrush((current) => ({ ...current, size: Math.max(8, current.size - 8) }));
      if (event.key === "]") setBrush((current) => ({ ...current, size: Math.min(220, current.size + 8) }));
      if (event.key === "0") engine.fit();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const shortcuts: Partial<Record<string, ToolId>> = {
        b: "soft",
        n: "hard",
        e: "eraser",
        p: "polygon",
        l: "lasso",
        g: "fill",
        h: "pan",
        v: "interact",
        j: "jiggle",
        u: "push",
        i: "pull",
        m: "smooth",
        f: "freeze",
        r: "restore",
      };
      const next = shortcuts[event.key.toLowerCase()];
      if (next) setTool(next);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space" && engineRef.current) engineRef.current.space = false;
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  async function openFile(file: File) {
    // Do not trust File.type as the only upload check. Android and
    // other mobile pickers can report valid photos as
    // application/octet-stream or leave the MIME type empty.
    // JiggleEngine.loadFile verifies the actual image signature.
    if (!file.size) {
      toast.error("That file is empty");
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    setBusy("Opening image…");
    try {
      await engine.loadFile(file);
      const region = makeRegion(1, presetById("jelly").params);
      engine.syncRegions([region], region.id);
      setRegions([region]);
      setActiveId(region.id);
      setPresetId("jelly");
      setTool("soft");
      setImageOn(true);
      setSheet(null);
      toast.success("Paint a region, then switch to Play");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that image");
    } finally {
      setBusy(null);
    }
  }

  async function openSample() {
    const engine = engineRef.current;
    if (!engine) return;
    setBusy("Loading sample…");
    try {
      await engine.loadDataUrl(gummyUrl);
      const region = makeRegion(1, presetById("jelly").params, "Gummy");
      engine.syncRegions([region], region.id);
      engine.selectWarmSubject();
      setRegions([region]);
      setActiveId(region.id);
      setPresetId("jelly");
      setTool("interact");
      setImageOn(true);
      setSheet(null);
      toast.success("Drag the gummy, tap it, or press Shake");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the sample");
    } finally {
      setBusy(null);
    }
  }

  apiRef.current = {
    loadSample: openSample,
    exercise: () => engineRef.current?.exercise() ?? null,
    debug: () => engineRef.current?.debug() ?? null,
  };

  async function openProjectFile(file: File) {
    const engine = engineRef.current;
    if (!engine) return;
    setBusy("Opening project…");
    try {
      const project = JSON.parse(await file.text()) as ProjectFile;
      await engine.ingestProject(project);
      toast.success("Project loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that project");
    } finally {
      setBusy(null);
    }
  }

  async function restoreSession() {
    const engine = engineRef.current;
    if (!engine) return;
    setBusy("Restoring session…");
    try {
      const project = await loadSession();
      if (!project) {
        toast.error("No saved session");
        setHasSession(false);
        return;
      }
      await engine.ingestProject(project);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore the session");
    } finally {
      setBusy(null);
    }
  }

  async function doReset() {
    engineRef.current?.clearImage();
    setRegions([]);
    setActiveId(null);
    setImageOn(false);
    setStatus(emptyStatus);
    setTool("soft");
    setConfirmReset(false);
    try {
      await clearSession();
    } catch {
      /* ignore */
    }
    setHasSession(false);
  }

  function patchRegion(id: string, partial: Partial<RegionMeta>) {
    setRegions((current) => current.map((region) => (region.id === id ? { ...region, ...partial } : region)));
  }

  function patchParams(partial: Partial<PhysicsParams>) {
    if (!activeId) return;
    setPresetId("");
    setRegions((current) =>
      current.map((region) =>
        region.id === activeId ? { ...region, params: { ...region.params, ...partial } } : region,
      ),
    );
  }

  function addRegion() {
    const region = makeRegion(regions.length + 1, active?.params ?? presetById("jelly").params);
    const next = [...regions, region];
    setRegions(next);
    setActiveId(region.id);
    setTool("soft");
  }

  function deleteRegion(id: string) {
    const next = regions.filter((region) => region.id !== id);
    setRegions(next);
    setActiveId((current) => (current === id ? next[0]?.id ?? null : current));
  }

  async function exportPNG() {
    const engine = engineRef.current;
    if (!engine) return;
    setBusy("Exporting PNG…");
    setExportOpen(false);
    try {
      const blob = await engine.exportPNG();
      downloadBlob(blob, "wobble.png");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function exportVideo() {
    const engine = engineRef.current;
    if (!engine) return;
    setExportOpen(false);
    setBusy("Recording video…");
    try {
      const blob = await engine.exportVideo(3);
      downloadBlob(blob, "wobble.webm");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Video export is not supported here");
    } finally {
      setBusy(null);
    }
  }

  async function exportGIF() {
    const engine = engineRef.current;
    if (!engine) return;
    setExportOpen(false);
    setBusy("Encoding GIF…");
    try {
      const blob = await engine.exportGIF(2);
      downloadBlob(blob, "wobble.gif");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "GIF export failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveProject() {
    const engine = engineRef.current;
    if (!engine) return;
    setExportOpen(false);
    setBusy("Saving project…");
    try {
      const project = await engine.toProject({ quality, shake, opacity: brush.opacity, overlay });
      downloadBlob(new Blob([JSON.stringify(project)], { type: "application/json" }), "wobble-project.json");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the project");
    } finally {
      setBusy(null);
    }
  }

  async function enableMotion() {
    try {
      const motionEvent = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<PermissionState | string> };
      if (typeof motionEvent.requestPermission === "function") {
        const result = await motionEvent.requestPermission();
        if (result !== "granted") {
          setMotion("denied");
          toast.error("Motion permission was denied. Use the Shake button instead.");
          return;
        }
      }
      const damp = { x: 0, y: 0 };
      const onMotion = (event: DeviceMotionEvent) => {
        let ax = event.acceleration?.x;
        let ay = event.acceleration?.y;
        if (ax == null || ay == null) {
          const gravity = event.accelerationIncludingGravity;
          if (gravity?.x == null || gravity.y == null) return;
          damp.x = damp.x * 0.9 + gravity.x * 0.1;
          damp.y = damp.y * 0.9 + gravity.y * 0.1;
          ax = gravity.x - damp.x;
          ay = gravity.y - damp.y;
        }
        engineRef.current?.applyMotion(ax, ay);
      };
      window.addEventListener("devicemotion", onMotion);
      setMotion("on");
      toast.success("Motion sensors on. Shake the phone to wobble the selection.");
    } catch {
      setMotion("denied");
      toast.error("This browser has no motion sensor. Use the Shake button.");
    }
  }

  function saveCustom() {
    if (!active || !presetName.trim()) return;
    const next = [...custom, { id: crypto.randomUUID(), name: presetName.trim(), params: cloneParams(active.params) }];
    setCustom(next);
    saveCustomPresets(next);
    setPresetName("");
    toast.success("Preset saved on this device");
  }

  const toolsPane = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-1">
        <button
          type="button"
          className={cn(
            "h-10 rounded-md text-sm font-medium",
            mode === "select" ? "bg-surface-3 text-fg" : "text-muted",
          )}
          onClick={() => setTool(mode === "select" ? tool : "soft")}
        >
          Select
        </button>
        <button
          type="button"
          className={cn(
            "h-10 rounded-md text-sm font-medium",
            mode === "play" ? "bg-accent text-accent-ink" : "text-muted",
          )}
          onClick={() => setTool("interact")}
        >
          Play
        </button>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted">Selection</h2>
        <div className="grid grid-cols-2 gap-1.5">
          <ToolButton icon={<Brush className="size-4" />} label="Soft" shortcut="B" active={tool === "soft"} onClick={() => setTool("soft")} />
          <ToolButton icon={<PenLine className="size-4" />} label="Hard" shortcut="N" active={tool === "hard"} onClick={() => setTool("hard")} />
          <ToolButton icon={<Eraser className="size-4" />} label="Eraser" shortcut="E" active={tool === "eraser"} onClick={() => setTool("eraser")} />
          <ToolButton icon={<Pentagon className="size-4" />} label="Polygon" shortcut="P" active={tool === "polygon"} onClick={() => setTool("polygon")} />
          <ToolButton icon={<Lasso className="size-4" />} label="Lasso" shortcut="L" active={tool === "lasso"} onClick={() => setTool("lasso")} />
          <ToolButton icon={<PaintBucket className="size-4" />} label="Fill" shortcut="G" active={tool === "fill"} onClick={() => setTool("fill")} />
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted">Brush</h2>
        <Field label="Size" value={brush.size} min={8} max={220} onChange={(size) => setBrush({ ...brush, size })} />
        <Field label="Strength" value={brush.strength} onChange={(strength) => setBrush({ ...brush, strength })} />
        <Field label="Edge softness" value={brush.softness} onChange={(softness) => setBrush({ ...brush, softness })} />
        <Field label="Overlay opacity" value={brush.opacity} onChange={(opacity) => setBrush({ ...brush, opacity })} />
        {tool === "fill" && (
          <Field label="Fill tolerance" value={brush.tolerance} onChange={(tolerance) => setBrush({ ...brush, tolerance })} />
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={cn("h-10 rounded-md text-sm", brush.additive ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted")}
            onClick={() => setBrush({ ...brush, additive: true })}
          >
            Add
          </button>
          <button
            type="button"
            className={cn("h-10 rounded-md text-sm", !brush.additive ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted")}
            onClick={() => setBrush({ ...brush, additive: false })}
          >
            Subtract
          </button>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          {tool === "polygon"
            ? "Click to place points. Click the first point or press Enter to close."
            : tool === "lasso"
              ? "Drag a free outline. It fills when you release."
              : tool === "fill"
                ? "Fills a patch of similar color. Softness feathers the edge."
                : "Paint only the parts that should move. Everything else stays rigid."}
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted">Sculpt</h2>
        <div className="grid grid-cols-2 gap-1.5">
          <ToolButton icon={<Waves className="size-4" />} label="Jiggle" shortcut="J" active={tool === "jiggle"} onClick={() => setTool("jiggle")} />
          <ToolButton icon={<Move className="size-4" />} label="Push" shortcut="U" active={tool === "push"} onClick={() => setTool("push")} />
          <ToolButton icon={<Magnet className="size-4" />} label="Pull" shortcut="I" active={tool === "pull"} onClick={() => setTool("pull")} />
          <ToolButton icon={<Blend className="size-4" />} label="Smooth" shortcut="M" active={tool === "smooth"} onClick={() => setTool("smooth")} />
          <ToolButton icon={<Snowflake className="size-4" />} label="Freeze" shortcut="F" active={tool === "freeze"} onClick={() => setTool("freeze")} />
          <ToolButton icon={<RotateCw className="size-4" />} label="Restore" shortcut="R" active={tool === "restore"} onClick={() => setTool("restore")} />
          <ToolButton icon={<Hand className="size-4" />} label="Pan" shortcut="H" active={tool === "pan"} onClick={() => setTool("pan")} />
        </div>
      </section>
    </div>
  );

  const physicsPane = (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted">Regions</h2>
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-fg hover:bg-surface-3" onClick={addRegion} disabled={!imageOn}>
            <Plus className="size-3.5" />
            Add
          </button>
        </div>
        {regions.length === 0 && <p className="text-sm text-muted">Load an image to create a region.</p>}
        <ul className="flex flex-col gap-1">
          {regions.map((region) => (
            <li key={region.id} className={cn("rounded-md px-1.5 py-1", region.id === activeId ? "bg-surface-3" : "hover:bg-surface-2")}>
              <div className="flex items-center gap-1.5">
                <span className="size-3 shrink-0 rounded-full" style={{ background: region.color }} />
                {region.id === activeId ? (
                  <input
                    value={region.name}
                    aria-label="Region name"
                    onChange={(event) => patchRegion(region.id, { name: event.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none"
                  />
                ) : (
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setActiveId(region.id)}>
                    {region.name}
                  </button>
                )}
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:text-fg" aria-label={region.visible ? "Hide region" : "Show region"} onClick={() => patchRegion(region.id, { visible: !region.visible })}>
                  {region.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:text-fg" aria-label="Settle region" onClick={() => engineRef.current?.resetRegion(region.id)}>
                  <RotateCcw className="size-4" />
                </button>
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:text-danger" aria-label="Delete region" onClick={() => deleteRegion(region.id)}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {active && (
          <div className="flex flex-wrap gap-1.5">
            {REGION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface", active.color === color && "ring-2 ring-fg")}
                style={{ background: color }}
                onClick={() => patchRegion(active.id, { color })}
              />
            ))}
            <button type="button" className="h-6 rounded-md px-2 text-xs text-muted hover:text-fg" onClick={() => engineRef.current?.clearActiveMask()}>
              Clear mask
            </button>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted">Presets</h2>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.blurb}
              disabled={!active}
              onClick={() => {
                if (!active) return;
                setPresetId(preset.id);
                patchRegion(active.id, { params: cloneParams(preset.params) });
              }}
              className={cn(
                "h-8 rounded-full border px-2.5 text-xs disabled:opacity-40",
                presetId === preset.id ? "border-accent bg-accent text-accent-ink" : "border-border text-fg hover:border-muted",
              )}
            >
              {preset.name}
            </button>
          ))}
        </div>
        {custom.length > 0 && (
          <ul className="flex flex-col gap-1">
            {custom.map((preset) => (
              <li key={preset.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="h-8 min-w-0 flex-1 truncate rounded-md px-2 text-left text-sm hover:bg-surface-3"
                  onClick={() => {
                    if (!active) return;
                    setPresetId(preset.id);
                    patchRegion(active.id, { params: cloneParams(preset.params) });
                  }}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${preset.name}`}
                  className="inline-flex size-8 items-center justify-center text-muted hover:text-danger"
                  onClick={() => {
                    const next = custom.filter((item) => item.id !== preset.id);
                    setCustom(next);
                    saveCustomPresets(next);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1.5">
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Custom preset name"
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg outline-none placeholder:text-muted"
          />
          <button type="button" className="h-10 rounded-md bg-surface-3 px-3 text-sm disabled:opacity-40" disabled={!active || !presetName.trim()} onClick={saveCustom}>
            Save
          </button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted">Physics {active ? `· ${active.name}` : ""}</h2>
        {active ? (
          <>
            <Field label="Elasticity" value={active.params.elasticity} onChange={(elasticity) => patchParams({ elasticity })} />
            <Field label="Stiffness" value={active.params.stiffness} onChange={(stiffness) => patchParams({ stiffness })} />
            <Field label="Damping" value={active.params.damping} onChange={(damping) => patchParams({ damping })} />
            <Field label="Mass" value={active.params.mass} onChange={(mass) => patchParams({ mass })} />
            <Field label="Gravity" value={active.params.gravity} onChange={(gravity) => patchParams({ gravity })} />
            <Field label="Bounce" value={active.params.bounce} onChange={(bounce) => patchParams({ bounce })} />
            <Field label="Deformation" value={active.params.deform} onChange={(deform) => patchParams({ deform })} />
            <Field label="Max displacement" value={active.params.maxDisp} onChange={(maxDisp) => patchParams({ maxDisp })} />
            <Field label="Recovery" value={active.params.recovery} onChange={(recovery) => patchParams({ recovery })} />
          </>
        ) : (
          <p className="text-sm text-muted">Select a region to tune how it moves.</p>
        )}
        <Field label="Mesh quality" value={quality} onChange={setQuality} />
        <Field label="Shake sensitivity" value={shake} onChange={setShake} />
        <button type="button" className="h-10 rounded-md bg-surface-3 text-sm disabled:opacity-50" onClick={() => void enableMotion()} disabled={motion === "on"}>
          {motion === "on" ? "Motion sensors on" : motion === "denied" ? "Sensors blocked — use Shake" : "Enable motion sensors"}
        </button>
      </section>
    </div>
  );

  const hint = !imageOn
    ? "Upload an image to begin"
    : mode === "select"
      ? "Paint the parts that should jiggle"
      : status.hasSelection
        ? "Drag to stretch · tap to bounce · release to settle"
        : "No selection yet — switch to Select and paint";

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
          <div className="mr-1 flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink">
              <Waves className="size-4" />
            </span>
            <span className="hidden text-sm font-semibold sm:inline">Wobble</span>
          </div>
          <IconButton label="Upload image" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" />
          </IconButton>
          <IconButton label="Undo" disabled={!status.canUndo} onClick={() => engineRef.current?.undo()}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label="Redo" disabled={!status.canRedo} onClick={() => engineRef.current?.redo()}>
            <Redo2 className="size-4" />
          </IconButton>
          <div className="mx-1 hidden items-center sm:flex">
            <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-0.5">
              <button type="button" className={cn("h-8 rounded-md px-2.5 text-xs font-medium", mode === "select" ? "bg-surface-3 text-fg" : "text-muted")} onClick={() => setTool("soft")}>
                Select
              </button>
              <button type="button" className={cn("h-8 rounded-md px-2.5 text-xs font-medium", mode === "play" ? "bg-accent text-accent-ink" : "text-muted")} onClick={() => setTool("interact")}>
                Play
              </button>
            </div>
          </div>
          <div className="flex-1" />
          <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-sm lg:hidden" onClick={() => setSheet(sheet === "tools" ? null : "tools")}>
            <Brush className="size-4" />
            Tools
          </button>
          <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-sm lg:hidden" onClick={() => setSheet(sheet === "physics" ? null : "physics")}>
            <SlidersHorizontal className="size-4" />
            Physics
          </button>
          <div className="relative">
            <IconButton label="Export and project" pressed={exportOpen} onClick={() => setExportOpen((open) => !open)} disabled={!imageOn}>
              <Download className="size-4" />
            </IconButton>
            {exportOpen && (
              <>
                <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="Close menu" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-border bg-surface-2 p-1 shadow-xl">
                  <MenuItem icon={<ImagePlus className="size-4" />} label="Export PNG" onClick={() => void exportPNG()} />
                  <MenuItem icon={<Film className="size-4" />} label="Export video" onClick={() => void exportVideo()} />
                  <MenuItem icon={<Waves className="size-4" />} label="Export GIF" onClick={() => void exportGIF()} />
                  <MenuItem icon={<FileJson className="size-4" />} label="Save project" onClick={() => void saveProject()} />
                  <MenuItem icon={<FolderOpen className="size-4" />} label="Open project" onClick={() => projectRef.current?.click()} />
                </div>
              </>
            )}
          </div>
          <IconButton label="Reset image" disabled={!imageOn} onClick={() => setConfirmReset(true)}>
            <RotateCcw className="size-4" />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden shrink-0 flex-col border-r border-border bg-surface lg:flex" style={{ width: leftW }}>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">{toolsPane}</div>
          </aside>
          <div
            className="hidden w-1.5 shrink-0 cursor-col-resize bg-border/40 hover:bg-accent lg:block"
            onPointerDown={(event) => {
              event.preventDefault();
              let last = event.clientX;
              const move = (ev: PointerEvent) => {
                const dx = ev.clientX - last;
                last = ev.clientX;
                setLeftW((width) => Math.max(200, Math.min(360, width + dx)));
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
          <main
            className={cn("relative min-w-0 flex-1", dragOver && "outline outline-2 outline-accent")}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer.files[0];
              if (file) {
                if (file.name.endsWith(".json")) void openProjectFile(file);
                else void openFile(file);
              }
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            {imageOn && status.width > 0 && (
              <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-xs text-muted">
                {status.width} × {status.height}
              </div>
            )}
            {busy && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-surface px-3 py-1.5 text-sm text-fg shadow">
                {busy}
              </div>
            )}
            {!imageOn && (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
                  <h1 className="text-2xl font-semibold tracking-tight">Make any photo jiggle</h1>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Paint a region, then drag it. Only that part stretches on a spring mesh and settles back. Images stay in the browser.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink" onClick={() => fileRef.current?.click()}>
                      <Upload className="size-4" />
                      Upload image
                    </button>
                    <button type="button" className="inline-flex h-11 items-center gap-2 rounded-md bg-surface-3 px-4 text-sm font-medium" onClick={() => void openSample()}>
                      <Waves className="size-4" />
                      Try the gummy
                    </button>
                  </div>
                  {hasSession && (
                    <button type="button" className="mt-3 text-sm text-mint hover:underline" onClick={() => void restoreSession()}>
                      Restore last session
                    </button>
                  )}
                  <p className="mt-4 text-xs text-muted">PNG, JPG, JPEG, WebP</p>
                </div>
              </div>
            )}
          </main>
          <div
            className="hidden w-1.5 shrink-0 cursor-col-resize bg-border/40 hover:bg-accent lg:block"
            onPointerDown={(event) => {
              event.preventDefault();
              let last = event.clientX;
              const move = (ev: PointerEvent) => {
                const dx = ev.clientX - last;
                last = ev.clientX;
                setRightW((width) => Math.max(240, Math.min(420, width - dx)));
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
          <aside className="hidden shrink-0 flex-col border-l border-border bg-surface lg:flex" style={{ width: rightW }}>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">{physicsPane}</div>
          </aside>
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-1 border-t border-border bg-surface px-2">
          <IconButton label={paused ? "Resume simulation" : "Pause simulation"} pressed={paused} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </IconButton>
          <IconButton label="Shake selection" disabled={!imageOn} onClick={() => engineRef.current?.shake(1)}>
            <Vibrate className="size-4" />
          </IconButton>
          <IconButton label={overlay ? "Hide selection overlay" : "Show selection overlay"} pressed={overlay} onClick={() => setOverlay((value) => !value)}>
            <Eye className="size-4" />
          </IconButton>
          <IconButton label={showMesh ? "Hide mesh" : "Show mesh"} pressed={showMesh} onClick={() => setShowMesh((value) => !value)}>
            <Scan className="size-4" />
          </IconButton>
          <IconButton label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.15)}>
            <ZoomOut className="size-4" />
          </IconButton>
          <button type="button" className="h-10 min-w-14 rounded-md px-2 text-xs tabular-nums text-muted hover:bg-surface-3" onClick={() => engineRef.current?.fit()}>
            {Math.round((status.zoom || 1) * 100)}%
          </button>
          <IconButton label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.15)}>
            <ZoomIn className="size-4" />
          </IconButton>
          <p className="ml-2 hidden min-w-0 flex-1 truncate text-xs text-muted md:block">{hint}</p>
          <span className={cn("ml-auto rounded-full px-2 py-1 text-xs", mode === "play" ? "bg-accent text-accent-ink" : "bg-surface-3 text-muted")}>
            {paused ? "Paused" : mode === "play" ? "Playing" : "Selecting"}
          </span>
        </footer>

        {sheet && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" className="absolute inset-0 bg-bg/70" aria-label="Close panel" onClick={() => setSheet(null)} />
            <div className="scroll-thin absolute inset-x-0 bottom-12 max-h-[72dvh] overflow-y-auto rounded-t-xl border border-border bg-surface p-3">
              {sheet === "tools" ? toolsPane : physicsPane}
            </div>
          </div>
        )}

        {confirmReset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/75 p-4">
            <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5">
              <h2 className="text-lg font-semibold">Reset the canvas?</h2>
              <p className="mt-1 text-sm text-muted">Clears the image, masks, and motion. Saved presets stay on this device.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="h-10 rounded-md px-3 text-sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
                <button type="button" className="h-10 rounded-md bg-danger px-3 text-sm font-medium text-fg" onClick={() => void doReset()}>
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void openFile(file);
          }}
        />
        <input
          ref={projectRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void openProjectFile(file);
          }}
        />
        <Toaster theme="dark" position="top-center" />
      </div>
    </Tooltip.Provider>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "inline-flex size-11 items-center justify-center rounded-md text-fg hover:bg-surface-3 disabled:opacity-35",
            pressed && "bg-surface-3 text-accent",
          )}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="z-50 rounded-md bg-fg px-2 py-1 text-xs text-bg" sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label} (${shortcut})`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-11 items-center gap-2 rounded-md px-2 text-left text-sm",
        active ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg hover:bg-surface-3",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function Field({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-fg">{Math.round(value)}</span>
      </span>
      <Slider.Root
        className="relative flex h-8 w-full touch-none items-center select-none"
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(values) => onChange(values[0] ?? value)}
      >
        <Slider.Track className="relative h-1.5 grow rounded-full bg-surface-3">
          <Slider.Range className="absolute h-full rounded-full bg-accent" />
        </Slider.Track>
        <Slider.Thumb className="block size-4 rounded-full border-2 border-accent bg-fg outline-none" aria-label={label} />
      </Slider.Root>
    </label>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-3" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
