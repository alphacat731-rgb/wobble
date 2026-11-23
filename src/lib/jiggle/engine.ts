import {
  boxBlur,
  clamp,
  compositeMax,
  fillPolygon,
  floodFill,
  hexToRgb,
  lerp,
  maskHasInk,
  morphMask,
  smoothBrush,
  smoothstep,
  stampBrush,
} from "@/lib/jiggle/mask";
import { SoftBody } from "@/lib/jiggle/sim";
import type { BrushSettings, EngineStatus, PhysicsParams, ProjectFile, RegionMeta, ToolId } from "@/lib/jiggle/types";
import { defaultBrush } from "@/lib/jiggle/types";

type RegionRec = {
  meta: RegionMeta;
  mask: Uint8Array;
  freeze: Uint8Array;
};

type Hist = { id: string; mask: Uint8Array; freeze: Uint8Array };

type GlPipe = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  wire: WebGLProgram;
  pos: WebGLBuffer;
  uv: WebGLBuffer;
  idx: WebGLBuffer;
  lines: WebGLBuffer;
  image: WebGLTexture;
  mask: WebGLTexture;
  aPos: number;
  aUV: number;
  uOrigin: WebGLUniformLocation | null;
  uZoom: WebGLUniformLocation | null;
  uView: WebGLUniformLocation | null;
  uImage: WebGLUniformLocation | null;
  uMask: WebGLUniformLocation | null;
  uOverlay: WebGLUniformLocation | null;
  wOrigin: WebGLUniformLocation | null;
  wZoom: WebGLUniformLocation | null;
  wView: WebGLUniformLocation | null;
  wColor: WebGLUniformLocation | null;
};

const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform vec2 uOrigin;
uniform float uZoom;
uniform vec2 uView;
varying vec2 vUV;
void main() {
  vec2 screen = (aPos - uOrigin) * uZoom;
  vec2 clip = vec2(screen.x / uView.x * 2.0 - 1.0, 1.0 - screen.y / uView.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV;
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uImage;
uniform sampler2D uMask;
uniform float uOverlay;
void main() {
  vec4 base = texture2D(uImage, vUV);
  vec4 ov = texture2D(uMask, vUV);
  float cells = mod(floor(gl_FragCoord.x / 12.0) + floor(gl_FragCoord.y / 12.0), 2.0);
  vec3 board = mix(vec3(0.047, 0.055, 0.071), vec3(0.09, 0.105, 0.135), cells);
  vec3 rgb = mix(board, base.rgb, base.a);
  rgb = mix(rgb, ov.rgb, clamp(ov.a * uOverlay, 0.0, 0.72));
  gl_FragColor = vec4(rgb, 1.0);
}
`;

const WIRE_FRAG = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }
`;

const MASK_LONG = 960;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "shader compile");
  }
  return shader;
}

function program(gl: WebGLRenderingContext, vs: string, fs: string) {
  const p = gl.createProgram();
  if (!p) throw new Error("program");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.bindAttribLocation(p, 1, "aUV");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "link");
  }
  return p;
}

function makeTexture(gl: WebGLRenderingContext) {
  const tex = gl.createTexture();
  if (!tex) throw new Error("texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return tex;
}

function createPipe(canvas: HTMLCanvasElement): GlPipe | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const prog = program(gl, VERT, FRAG);
  const wire = program(gl, VERT, WIRE_FRAG);
  const buffer = () => {
    const b = gl.createBuffer();
    if (!b) throw new Error("buffer");
    return b;
  };
  return {
    gl,
    program: prog,
    wire,
    pos: buffer(),
    uv: buffer(),
    idx: buffer(),
    lines: buffer(),
    image: makeTexture(gl),
    mask: makeTexture(gl),
    aPos: 0,
    aUV: 1,
    uOrigin: gl.getUniformLocation(prog, "uOrigin"),
    uZoom: gl.getUniformLocation(prog, "uZoom"),
    uView: gl.getUniformLocation(prog, "uView"),
    uImage: gl.getUniformLocation(prog, "uImage"),
    uMask: gl.getUniformLocation(prog, "uMask"),
    uOverlay: gl.getUniformLocation(prog, "uOverlay"),
    wOrigin: gl.getUniformLocation(wire, "uOrigin"),
    wZoom: gl.getUniformLocation(wire, "uZoom"),
    wView: gl.getUniformLocation(wire, "wView") ?? gl.getUniformLocation(wire, "uView"),
    wColor: gl.getUniformLocation(wire, "uColor"),
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode this image. Please use PNG, JPG, or WebP."));
    img.src = src;
  });
}

function readFile(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function maskToPng(mask: Uint8Array, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    image.data[i * 4] = mask[i]!;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

async function pngToMask(url: string, w: number, h: number) {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const mask = new Uint8Array(w * h);
  if (!ctx) return mask;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4]!;
  return mask;
}

export class JiggleEngine {
  onChange: ((status: EngineStatus) => void) | null = null;
  onProject: ((
    project: ProjectFile,
    regions: RegionMeta[],
  ) => void) | null = null;

  tool: ToolId = "soft";
  brush: BrushSettings = defaultBrush();
  quality = 46;
  shakeSensitivity = 55;
  overlay = true;
  showMesh = false;
  paused = false;
  space = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D | null;
  private pipe: GlPipe | null = null;
  private exportPipe: GlPipe | null = null;
  private exportCanvas: HTMLCanvasElement | null = null;
  private sim: SoftBody | null = null;
  private regions = new Map<string, RegionRec>();
  private order: string[] = [];
  private activeId: string | null = null;
  private undoStack: Hist[] = [];
  private redoStack: Hist[] = [];
  private workCanvas: HTMLCanvasElement | null = null;
  private pixels: Uint8ClampedArray | null = null;
  private dataUrl: string | null = null;
  private naturalW = 0;
  private naturalH = 0;
  private workW = 0;
  private workH = 0;
  private mw = 0;
  private mh = 0;
  private originX = 0;
  private originY = 0;
  private zoom = 1;
  private dpr = 1;
  private didFit = false;
  private weightsDirty = false;
  private overlayDirty = false;
  private hasSelection = false;
  private imageReady = false;
  private glFailed = false;
  private maxTex = 4096;
  private maxViewport = 4096;
  private pos = new Float32Array(0);
  private uv = new Float32Array(0);
  private indices = new Uint16Array(0);
  private lineIdx = new Uint16Array(0);
  private triCount = 0;
  private wBuf = new Float32Array(0);
  private rBuf = new Int16Array(0);
  private fBuf = new Uint8Array(0);
  private overlayPixels = new Uint8Array(0);
  private raf = 0;
  private last = 0;
  private disposed = false;
  private painting = false;
  private panning = false;
  private pinching = false;
  private grabPoint: { x: number; y: number } | null = null;
  private grabRegion = -1;
  private downCss = { x: 0, y: 0 };
  private downTime = 0;
  private lastMask: { x: number; y: number } | null = null;
  private polyImage: { x: number; y: number }[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchPrev: { dist: number; midX: number; midY: number } | null = null;
  private panLast = { x: 0, y: 0 };
  private cursor: { x: number; y: number } | null = null;
  private shakeT = 0;
  private shakePhase = 0;
  private shakeAng = 0;
  private shakeAmp = 1;
  private emitQueued = false;
  private ro: ResizeObserver | null = null;
  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onCtx: (e: Event) => void;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.canvas = canvas;
    this.overlayCanvas = overlay;
    this.octx = overlay.getContext("2d");
    try {
      this.pipe = createPipe(canvas);
      if (!this.pipe) this.glFailed = true;
      else {
        this.maxTex = this.pipe.gl.getParameter(this.pipe.gl.MAX_TEXTURE_SIZE) as number;
        const vp = this.pipe.gl.getParameter(this.pipe.gl.MAX_VIEWPORT_DIMS) as Int32Array;
        this.maxViewport = vp[0] || 4096;
      }
    } catch {
      this.pipe = null;
      this.glFailed = true;
    }

    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onWheel = (e) => {
      e.preventDefault();
      const css = this.cssOf(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0011);
      this.zoomAt(css.x, css.y, factor);
    };
    this.onCtx = (e) => e.preventDefault();
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onCtx);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
    this.pipe?.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.exportPipe?.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.weightsDirty) this.resample();
    this.tickShake(dt);
    if (this.sim && (!this.paused || this.sim.isGrabbing)) this.sim.step(dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private tickShake(dt: number) {
    if (this.shakeT <= 0 || !this.sim) return;
    const unit = this.workW / 1000 || 1;
    const amp = lerp(280, 3400, this.shakeSensitivity / 100) * unit * this.shakeAmp;
    const wave = Math.sin(this.shakePhase) * amp * Math.min(1, this.shakeT * 4);
    this.sim.accelerate(Math.cos(this.shakeAng) * wave * dt, Math.sin(this.shakeAng) * wave * dt);
    this.shakePhase += dt * 34;
    this.shakeT -= dt;
  }

  shake(scale = 1) {
    this.shakeT = 0.62;
    this.shakeAmp = scale;
    this.shakeAng = Math.random() * Math.PI * 2;
    this.shakePhase = 0;
  }

  applyMotion(ax: number, ay: number, az = 0, intervalMs = 16) {
    if (!this.sim || this.paused) return;
    const sens = clamp(this.shakeSensitivity / 100, 0, 1);
    const mag = Math.hypot(ax, ay, az);
    const threshold = lerp(9, 2.2, sens);
    if (!Number.isFinite(mag) || mag < threshold) return;

    // The phone's Z axis points through the screen. Project some of that
    // impulse onto both canvas axes so front-to-back shakes are not ignored.
    const screenX = ax + az * 0.7;
    const screenY = -ay + az * 0.7;
    const unit = this.workW / 1000 || 1;
    const gain = lerp(10, 92, sens) * unit;
    const eventScale = clamp(intervalMs / 16, 0.5, 2);
    const strength = ((mag - threshold) / Math.max(mag, 0.001)) * gain * 0.022 * eventScale;
    this.sim.accelerate(screenX * strength, screenY * strength);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.overlayCanvas.width = bw;
      this.overlayCanvas.height = bh;
    }
    this.dpr = dpr;
    if (this.imageReady && !this.didFit && w > 2 && h > 2) {
      this.fit();
      this.didFit = true;
    }
  }

  fit() {
    if (!this.workW || !this.canvas.clientWidth) return;
    const z = Math.min(this.canvas.clientWidth / this.workW, this.canvas.clientHeight / this.workH) * 0.92;
    this.zoom = clamp(z, 0.02, 32);
    this.originX = (this.workW - this.canvas.clientWidth / this.zoom) / 2;
    this.originY = (this.workH - this.canvas.clientHeight / this.zoom) / 2;
    this.emit();
  }

  zoomBy(factor: number) {
    const x = this.canvas.clientWidth / 2;
    const y = this.canvas.clientHeight / 2;
    this.zoomAt(x, y, factor);
  }

  private zoomAt(cssX: number, cssY: number, factor: number) {
    if (!this.imageReady) return;
    const ix = this.originX + cssX / this.zoom;
    const iy = this.originY + cssY / this.zoom;
    const minZ = Math.min(this.canvas.clientWidth / this.workW, this.canvas.clientHeight / this.workH) * 0.2;
    this.zoom = clamp(this.zoom * factor, minZ, 16);
    this.originX = ix - cssX / this.zoom;
    this.originY = iy - cssY / this.zoom;
    this.emit();
  }

  private cssOf(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private imageOf(cssX: number, cssY: number) {
    return { x: this.originX + cssX / this.zoom, y: this.originY + cssY / this.zoom };
  }

  private toMask(ix: number, iy: number) {
    return { x: (ix / this.workW) * this.mw, y: (iy / this.workH) * this.mh };
  }

  async loadFile(file: Blob) {
    if (!file.size) throw new Error("That file is empty");

    // Inspect the bytes instead of trusting the MIME type supplied
    // by the operating system. This fixes valid phone photos that
    // arrive as application/octet-stream or with no MIME type.
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    let mime: string | null = null;

    const isPng =
      header.length >= 8 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a;
    const isJpeg =
      header.length >= 3 &&
      header[0] === 0xff &&
      header[1] === 0xd8 &&
      header[2] === 0xff;
    const isWebp =
      header.length >= 12 &&
      String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...header.slice(8, 12)) === "WEBP";

    if (isPng) mime = "image/png";
    else if (isJpeg) mime = "image/jpeg";
    else if (isWebp) mime = "image/webp";

    if (!mime) {
      throw new Error("Unsupported image. Please use a PNG, JPG, or WebP file.");
    }

    const dataUrl = await readFile(file);
    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("The image file could not be read");

    // Rebuild the data URL with the verified MIME type. Some
    // browsers otherwise label valid JPEG/PNG bytes as octet-stream,
    // which makes the Image decoder reject them.
    await this.loadDataUrl(`data:${mime};base64,${dataUrl.slice(separator + 1)}`);
  }

  async loadDataUrl(dataUrl: string) {
    const img = await loadImage(dataUrl);
    await this.loadSource(img, img.naturalWidth, img.naturalHeight, dataUrl);
  }

  private async loadSource(
    source: CanvasImageSource,
    naturalW: number,
    naturalH: number,
    dataUrl: string | null,
  ) {
    if (!naturalW || !naturalH) throw new Error("That image has no pixels");
    this.naturalW = naturalW;
    this.naturalH = naturalH;
    this.dataUrl = dataUrl;
    const limit = Math.min(this.maxTex || 4096, 4096);
    let w = naturalW;
    let h = naturalH;
    if (w > limit || h > limit) {
      const s = limit / Math.max(w, h);
      w = Math.max(2, Math.round(naturalW * s));
      h = Math.max(2, Math.round(naturalH * s));
    }
    this.workW = w;
    this.workH = h;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the image");
    ctx.drawImage(source, 0, 0, w, h);
    this.workCanvas = canvas;
    this.imageReady = true;
    this.didFit = false;
    this.undoStack = [];
    this.redoStack = [];
    this.polyImage = [];
    const scale = MASK_LONG / Math.max(w, h);
    this.mw = Math.max(2, Math.round(w * scale));
    this.mh = Math.max(2, Math.round(h * scale));
    this.allocMasks(true);
    const sample = document.createElement("canvas");
    sample.width = this.mw;
    sample.height = this.mh;
    const sctx = sample.getContext("2d");
    if (sctx) {
      sctx.drawImage(canvas, 0, 0, this.mw, this.mh);
      this.pixels = sctx.getImageData(0, 0, this.mw, this.mh).data;
    }
    this.uploadImage(canvas);
    this.rebuildSim();
    this.overlayDirty = true;
    this.weightsDirty = true;
    this.resize();
    if (this.canvas.clientWidth > 2) {
      this.fit();
      this.didFit = true;
    }
    this.emit();
  }

  private allocMasks(clear: boolean) {
    const n = this.mw * this.mh;
    for (const rec of this.regions.values()) {
      if (clear || rec.mask.length !== n) {
        rec.mask = new Uint8Array(n);
        rec.freeze = new Uint8Array(n);
      }
    }
  }

  syncRegions(list: RegionMeta[], activeId: string | null) {
    const n = this.mw * this.mh;
    const next = new Map<string, RegionRec>();
    for (const meta of list) {
      const prev = this.regions.get(meta.id);
      const mask = prev && prev.mask.length === n ? prev.mask : new Uint8Array(n);
      const freeze = prev && prev.freeze.length === n ? prev.freeze : new Uint8Array(n);
      next.set(meta.id, { meta, mask, freeze });
    }
    this.regions = next;
    this.order = list.map((region) => region.id);
    this.activeId = activeId;
    this.weightsDirty = true;
    this.overlayDirty = true;
    this.refreshSelection();
  }

  setBrush(brush: BrushSettings) {
    if (brush.opacity !== this.brush.opacity) this.overlayDirty = true;
    this.brush = brush;
  }

  clearImage() {
    this.sim?.endGrab();
    this.imageReady = false;
    this.sim = null;
    this.workCanvas = null;
    this.dataUrl = null;
    this.pixels = null;
    this.regions.clear();
    this.order = [];
    this.activeId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.polyImage = [];
    this.hasSelection = false;
    this.naturalW = 0;
    this.naturalH = 0;
    this.didFit = false;
    this.emit();
  }

  selectWarmSubject() {
    const rec = this.activeRec();
    if (!rec || !this.pixels) return;
    this.pushHistory(rec);
    const n = this.mw * this.mh;
    const temp = new Uint8Array(n);
    const pix = this.pixels;
    for (let i = 0; i < n; i++) {
      const r = pix[i * 4]!;
      const g = pix[i * 4 + 1]!;
      const b = pix[i * 4 + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (r > 58 && r >= g - 8 && r > b + 6 && max - min > 16) temp[i] = 255;
    }
    rec.mask.set(boxBlur(temp, this.mw, this.mh, 5, 2));
    this.markMask();
  }

  clearActiveMask() {
    const rec = this.activeRec();
    if (!rec) return;
    this.pushHistory(rec);
    rec.mask.fill(0);
    rec.freeze.fill(0);
    this.markMask();
  }

  invertActiveMask() {
    const rec = this.activeRec();
    if (!rec) return;
    this.pushHistory(rec);
    for (let i = 0; i < rec.mask.length; i++) rec.mask[i] = 255 - rec.mask[i]!;
    rec.freeze.fill(0);
    this.markMask();
  }

  featherActiveMask() {
    const rec = this.activeRec();
    if (!rec) return;
    this.pushHistory(rec);
    rec.mask.set(boxBlur(rec.mask, this.mw, this.mh, 6, 2));
    this.markMask();
  }

  expandActiveMask() {
    const rec = this.activeRec();
    if (!rec) return;
    this.pushHistory(rec);
    rec.mask.set(morphMask(rec.mask, this.mw, this.mh, true, 2));
    this.markMask();
  }

  contractActiveMask() {
    const rec = this.activeRec();
    if (!rec) return;
    this.pushHistory(rec);
    rec.mask.set(morphMask(rec.mask, this.mw, this.mh, false, 2));
    this.markMask();
  }

  resetRegion(id: string) {
    const idx = this.order.indexOf(id);
    const rec = this.regions.get(id);
    if (!rec || idx < 0) return;
    this.pushHistory(rec);
    rec.freeze.fill(0);
    this.weightsDirty = true;
    this.overlayDirty = true;
    this.resample();
    this.sim?.resetRegion(idx);
    this.emit();
  }

  undo() {
    this.restore(this.undoStack, this.redoStack);
  }

  redo() {
    this.restore(this.redoStack, this.undoStack);
  }

  private restore(from: Hist[], to: Hist[]) {
    const entry = from.pop();
    if (!entry) return;
    const rec = this.regions.get(entry.id);
    if (!rec || rec.mask.length !== entry.mask.length) return;
    to.push({ id: entry.id, mask: rec.mask.slice(), freeze: rec.freeze.slice() });
    rec.mask.set(entry.mask);
    rec.freeze.set(entry.freeze);
    this.markMask();
  }

  setQuality(quality: number) {
    this.quality = quality;
    if (this.imageReady) this.rebuildSim();
  }

  closePolygon() {
    if (this.polyImage.length >= 3) this.commitShape(this.polyImage);
    else this.polyImage = [];
  }

  cancelShape() {
    this.polyImage = [];
    this.painting = false;
  }

  async ingestProject(project: ProjectFile) {
    if (project.app !== "wobble" || project.version !== 1 || !project.image) {
      throw new Error("That file is not a Wobble project");
    }
    await this.loadDataUrl(project.image);
    const metas: RegionMeta[] = [];
    const next = new Map<string, RegionRec>();
    for (const region of project.regions) {
      const meta: RegionMeta = {
        id: region.id,
        name: region.name,
        color: region.color,
        visible: region.visible !== false,
        params: { ...region.params },
      };
      next.set(meta.id, {
        meta,
        mask: await pngToMask(region.mask, this.mw, this.mh),
        freeze: await pngToMask(region.freeze || region.mask, this.mw, this.mh),
      });
      if (!region.freeze) next.get(meta.id)!.freeze.fill(0);
      metas.push(meta);
    }
    this.regions = next;
    this.order = metas.map((region) => region.id);
    this.activeId = project.activeId && next.has(project.activeId) ? project.activeId : metas[0]?.id ?? null;
    this.quality = project.quality || this.quality;
    this.shakeSensitivity = project.shake ?? this.shakeSensitivity;
    this.brush = { ...this.brush, opacity: project.opacity ?? this.brush.opacity };
    this.overlay = project.overlay !== false;
    this.rebuildSim();
    this.markMask();
    this.onProject?.(project, metas);
  }

  async toProject(extra: { quality: number; shake: number; opacity: number; overlay: boolean }): Promise<ProjectFile> {
    const image = this.dataUrl ?? this.workCanvas?.toDataURL("image/jpeg", 0.92) ?? "";
    const regions = this.order.map((id) => {
      const rec = this.regions.get(id)!;
      return {
        ...rec.meta,
        params: { ...rec.meta.params },
        mask: maskToPng(rec.mask, this.mw, this.mh),
        freeze: maskToPng(rec.freeze, this.mw, this.mh),
      };
    });
    return {
      version: 1,
      app: "wobble",
      image,
      activeId: this.activeId,
      quality: extra.quality,
      shake: extra.shake,
      opacity: extra.opacity,
      overlay: extra.overlay,
      regions,
    };
  }

  async exportPNG() {
    if (!this.imageReady || !this.sim || !this.workCanvas) throw new Error("Load an image first");
    const maxDim = Math.min(this.maxViewport || 4096, 8192);
    let ew = this.naturalW;
    let eh = this.naturalH;
    if (ew > maxDim || eh > maxDim) {
      const s = maxDim / Math.max(ew, eh);
      ew = Math.max(2, Math.round(this.naturalW * s));
      eh = Math.max(2, Math.round(this.naturalH * s));
    }
    const canvas = this.exportCanvas ?? document.createElement("canvas");
    this.exportCanvas = canvas;
    if (canvas.width !== ew || canvas.height !== eh) {
      canvas.width = ew;
      canvas.height = eh;
    }
    if (!this.exportPipe) {
      this.exportPipe = createPipe(canvas);
      if (!this.exportPipe) throw new Error("Could not export this image");
      this.uploadImageTo(this.exportPipe, this.workCanvas);
    } else if (this.exportPipe.gl.canvas !== canvas) {
      this.exportPipe = createPipe(canvas);
      if (!this.exportPipe) throw new Error("Could not export this image");
      this.uploadImageTo(this.exportPipe, this.workCanvas);
    }
    this.uploadMesh(this.exportPipe, ew / this.workW, eh / this.workH);
    this.draw(this.exportPipe, 0, 0, 1, ew, eh, ew, eh, false);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode PNG");
    return blob;
  }

  async exportVideo(seconds = 3) {
    const canvas = this.canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream };
    if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      throw new Error("This browser cannot record video");
    }
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mime) throw new Error("This browser cannot record video");
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });
    this.shake(1);
    rec.start();
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    rec.stop();
    return done;
  }

  async exportGIF(seconds = 2) {
    if (!this.imageReady) throw new Error("Load an image first");
    const maxW = 440;
    const cssW = Math.max(2, this.canvas.clientWidth);
    const cssH = Math.max(2, this.canvas.clientHeight);
    const scale = Math.min(1, maxW / cssW);
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not encode GIF");
    const frames: Uint8ClampedArray[] = [];
    const count = Math.round(seconds * 10);
    const delay = Math.round(1000 / 10);
    const wasPaused = this.paused;
    this.paused = false;
    this.shake(1);
    for (let i = 0; i < count; i++) {
      this.tickShake(delay / 1000);
      this.sim?.step(delay / 1000);
      this.render();
      ctx.drawImage(this.canvas, 0, 0, w, h);
      frames.push(ctx.getImageData(0, 0, w, h).data);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.paused = wasPaused;
    const gifenc = await import("gifenc");
    const gif = gifenc.GIFEncoder();
    for (let i = 0; i < frames.length; i++) {
      const data = frames[i]!;
      const palette = gifenc.quantize(data, 128);
      const index = gifenc.applyPalette(data, palette);
      gif.writeFrame(index, w, h, { palette, delay, repeat: 0 });
    }
    gif.finish();
    return new Blob([gif.bytes().slice()], { type: "image/gif" });
  }

  debug() {
    return {
      maxOffset: this.sim?.maxOffset() ?? 0,
      dynamic: this.sim?.dynamicCount() ?? 0,
      verts: this.sim?.count ?? 0,
      cols: this.sim?.cols ?? 0,
      rows: this.sim?.rows ?? 0,
      hasSelection: this.hasSelection,
      zoom: this.zoom,
      workW: this.workW,
      workH: this.workH,
      glFailed: this.glFailed,
      regions: this.order.length,
    };
  }

  exercise() {
    if (!this.sim) return { ok: false, reason: "no-sim" };
    const ix = this.workW * 0.5;
    const iy = this.workH * 0.48;
    const region = this.hitRegion(ix, iy);
    if (region < 0) return { ok: false, reason: "no-hit", ...this.debug() };
    const radius = Math.min(this.workW, this.workH) * 0.4;
    const grabbed = this.sim.beginGrab(ix, iy, region, radius);
    let peak = 0;
    const pull = this.workW * 0.1;
    for (let f = 1; f <= 24; f++) {
      this.sim.updateGrab((f / 24) * pull, (f / 24) * this.workH * 0.03);
      this.sim.step(1 / 60);
      peak = Math.max(peak, this.sim.maxOffset(region));
    }
    this.sim.endGrab();
    const samples: number[] = [];
    for (let f = 0; f < 120; f++) {
      this.sim.step(1 / 60);
      if (f % 10 === 0) samples.push(Number(this.sim.maxOffset(region).toFixed(2)));
    }
    const end = this.sim.maxOffset(region);
    const others = this.order.map((_, index) => this.sim?.maxOffset(index) ?? 0);
    return {
      ok: grabbed && peak > 6 && end < peak * 0.55,
      grabbed,
      peak,
      end,
      samples,
      region,
      others,
      dynamic: this.sim.dynamicCount(),
    };
  }

  private pointerDown(e: PointerEvent) {
    if (e.button === 2) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const css = this.cssOf(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, css);
    if (this.pointers.size >= 2) {
      this.pinching = true;
      this.painting = false;
      this.panning = false;
      this.sim?.endGrab();
      this.pinchPrev = this.pinchMetrics();
      return;
    }
    if (!this.imageReady) return;
    if (this.space || e.button === 1 || this.tool === "pan") {
      this.panning = true;
      this.panLast = css;
      return;
    }
    const image = this.imageOf(css.x, css.y);
    this.downCss = css;
    this.downTime = performance.now();
    if (this.tool === "polygon") {
      if (this.polyImage.length >= 3) {
        const first = this.polyImage[0]!;
        if (Math.hypot(first.x - image.x, first.y - image.y) < 14 / this.zoom) {
          this.commitShape(this.polyImage);
          return;
        }
      }
      this.polyImage = [...this.polyImage, image];
      return;
    }
    if (this.tool === "fill") {
      this.doFill(image.x, image.y);
      return;
    }
    if (this.tool === "lasso") {
      this.painting = true;
      this.polyImage = [image];
      return;
    }
    if (this.tool === "interact") {
      const region = this.hitRegion(image.x, image.y);
      if (region < 0 || !this.sim) return;
      const params = this.regions.get(this.order[region]!)?.meta.params;
      const radius = Math.min(this.workW, this.workH) * lerp(0.2, 0.48, (params?.deform ?? 60) / 100);
      if (this.sim.beginGrab(image.x, image.y, region, radius)) {
        this.painting = true;
        this.grabPoint = image;
        this.grabRegion = region;
      }
      return;
    }
    if (this.tool === "jiggle" || this.tool === "push" || this.tool === "pull" || this.tool === "restore") {
      this.painting = true;
      this.applyForce(image.x, image.y);
      return;
    }
    const rec = this.activeRec();
    if (!rec) return;
    this.pushHistory(rec);
    this.painting = true;
    this.lastMask = null;
    this.paintAt(image.x, image.y);
  }

  private pointerMove(e: PointerEvent) {
    const css = this.cssOf(e.clientX, e.clientY);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, css);
    this.cursor = css;
    if (this.pinching && this.pointers.size >= 2) {
      const now = this.pinchMetrics();
      if (now && this.pinchPrev) {
        const factor = now.dist / this.pinchPrev.dist;
        this.zoomAt(now.midX, now.midY, factor);
        this.originX -= (now.midX - this.pinchPrev.midX) / this.zoom;
        this.originY -= (now.midY - this.pinchPrev.midY) / this.zoom;
        this.pinchPrev = now;
      }
      return;
    }
    if (this.panning) {
      this.originX -= (css.x - this.panLast.x) / this.zoom;
      this.originY -= (css.y - this.panLast.y) / this.zoom;
      this.panLast = css;
      return;
    }
    if (!this.painting || !this.imageReady) return;
    const image = this.imageOf(css.x, css.y);
    if (this.tool === "lasso") {
      const last = this.polyImage[this.polyImage.length - 1];
      if (!last || Math.hypot(last.x - image.x, last.y - image.y) > 2 / this.zoom) this.polyImage.push(image);
      return;
    }
    if (this.tool === "interact" && this.grabPoint && this.sim) {
      this.sim.updateGrab(image.x - this.grabPoint.x, image.y - this.grabPoint.y);
      return;
    }
    if (this.tool === "jiggle" || this.tool === "push" || this.tool === "pull" || this.tool === "restore") {
      this.applyForce(image.x, image.y);
      return;
    }
    this.paintAt(image.x, image.y);
  }

  private pointerUp(e: PointerEvent) {
    const css = this.pointers.get(e.pointerId) ?? this.cssOf(e.clientX, e.clientY);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) {
      this.pinching = false;
      this.pinchPrev = null;
    }
    if (this.panning) {
      this.panning = false;
      this.emit();
      return;
    }
    if (this.tool === "lasso" && this.painting) {
      this.painting = false;
      if (this.polyImage.length > 2) {
        const first = this.polyImage[0]!;
        this.polyImage.push(first);
        this.commitShape(this.polyImage);
      }
      this.polyImage = [];
      return;
    }
    if (this.tool === "interact" && this.painting && this.grabPoint && this.sim) {
      const image = this.imageOf(css.x, css.y);
      const moved = Math.hypot(css.x - this.downCss.x, css.y - this.downCss.y);
      const quick = performance.now() - this.downTime < 260;
      const region = this.grabRegion;
      this.sim.endGrab();
      this.painting = false;
      if (quick && moved < 8 && region >= 0) {
        const radius = Math.min(this.workW, this.workH) * 0.22;
        this.sim.tap(image.x, image.y, region, radius);
      }
      this.grabPoint = null;
      return;
    }
    if (this.painting) {
      this.painting = false;
      this.lastMask = null;
      this.refreshSelection();
      this.emit();
    }
  }

  private pinchMetrics() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const dx = pts[0]!.x - pts[1]!.x;
    const dy = pts[0]!.y - pts[1]!.y;
    return {
      dist: Math.max(1, Math.hypot(dx, dy)),
      midX: (pts[0]!.x + pts[1]!.x) / 2,
      midY: (pts[0]!.y + pts[1]!.y) / 2,
    };
  }

  private paintAt(ix: number, iy: number) {
    const rec = this.activeRec();
    if (!rec) return;
    const target = this.tool === "freeze" ? rec.freeze : rec.mask;
    const m = this.toMask(ix, iy);
    const radius = Math.max(1, ((this.brush.size * 0.5) / this.zoom / this.workW) * this.mw);
    if (this.tool === "smooth") {
      smoothBrush(rec.mask, this.mw, this.mh, m.x, m.y, radius, this.brush.strength / 100);
      this.markMask();
      this.lastMask = m;
      return;
    }
    const hard = this.tool === "hard";
    const add = this.tool === "eraser" ? false : this.tool === "freeze" ? this.brush.additive : this.brush.additive;
    const stamp = (x: number, y: number) =>
      stampBrush(target, this.mw, this.mh, x, y, radius, this.brush.strength / 100, this.brush.softness / 100, add, hard);
    if (this.lastMask) {
      const dist = Math.hypot(m.x - this.lastMask.x, m.y - this.lastMask.y);
      const step = Math.max(1, radius * 0.22);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        stamp(this.lastMask.x + (m.x - this.lastMask.x) * t, this.lastMask.y + (m.y - this.lastMask.y) * t);
      }
    } else stamp(m.x, m.y);
    this.lastMask = m;
    this.markMask();
  }

  private applyForce(ix: number, iy: number) {
    if (!this.sim) return;
    const region = this.hitRegion(ix, iy);
    const useRegion = region >= 0 ? region : this.order.indexOf(this.activeId ?? "");
    const radius = Math.max(8, (this.brush.size * 0.5) / this.zoom);
    const unit = this.workW / 1000 || 1;
    const power = lerp(30, 980, this.brush.strength / 100) * unit;
    const kind = this.tool === "push" || this.tool === "pull" || this.tool === "restore" || this.tool === "jiggle"
      ? this.tool
      : "jiggle";
    this.sim.applyBrush(kind, ix, iy, radius, power, useRegion, performance.now());
  }

  private doFill(ix: number, iy: number) {
    const rec = this.activeRec();
    if (!rec || !this.pixels) return;
    this.pushHistory(rec);
    const m = this.toMask(ix, iy);
    const tol = lerp(6, 150, this.brush.tolerance / 100);
    let temp = floodFill(this.pixels, this.mw, this.mh, m.x, m.y, tol);
    const soft = this.brush.softness / 100;
    if (soft > 0.04) temp = boxBlur(temp, this.mw, this.mh, Math.max(1, Math.round(soft * 8)), 1);
    compositeMax(rec.mask, temp, this.brush.additive, this.brush.strength / 100);
    this.markMask();
  }

  private commitShape(points: { x: number; y: number }[]) {
    const rec = this.activeRec();
    this.polyImage = [];
    if (!rec || points.length < 3) return;
    this.pushHistory(rec);
    const maskPts = points.map((point) => this.toMask(point.x, point.y));
    let temp = fillPolygon(maskPts, this.mw, this.mh);
    const soft = this.brush.softness / 100;
    if (soft > 0.02) temp = boxBlur(temp, this.mw, this.mh, Math.max(1, Math.round(soft * 12)), 2);
    const add = this.tool === "eraser" ? false : this.brush.additive;
    compositeMax(rec.mask, temp, add, this.brush.strength / 100);
    this.markMask();
  }

  private pushHistory(rec: RegionRec) {
    this.undoStack.push({ id: rec.meta.id, mask: rec.mask.slice(), freeze: rec.freeze.slice() });
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }

  private markMask() {
    this.weightsDirty = true;
    this.overlayDirty = true;
    this.refreshSelection();
    this.emit();
  }

  private refreshSelection() {
    let any = false;
    for (const rec of this.regions.values()) {
      if (rec.meta.visible && maskHasInk(rec.mask)) {
        any = true;
        break;
      }
    }
    this.hasSelection = any;
  }

  private activeRec() {
    if (!this.activeId) return undefined;
    return this.regions.get(this.activeId);
  }

  private hitRegion(ix: number, iy: number) {
    if (!this.mw || !this.workW) return -1;
    const mx = clamp(Math.round((ix / this.workW) * (this.mw - 1)), 0, this.mw - 1);
    const my = clamp(Math.round((iy / this.workH) * (this.mh - 1)), 0, this.mh - 1);
    const index = my * this.mw + mx;
    const active = this.order.indexOf(this.activeId ?? "");
    if (active >= 0) {
      const rec = this.regions.get(this.order[active]!);
      if (rec?.meta.visible && (rec.mask[index] ?? 0) > 16) return active;
    }
    let best = -1;
    let bestV = 16;
    this.order.forEach((id, regionIndex) => {
      const rec = this.regions.get(id);
      if (!rec?.meta.visible) return;
      const value = rec.mask[index] ?? 0;
      if (value > bestV) {
        bestV = value;
        best = regionIndex;
      }
    });
    return best;
  }

  private rebuildSim() {
    if (!this.workW) return;
    const q = this.quality / 100;
    let cols = Math.round(lerp(16, 56, q));
    let rows = Math.max(10, Math.round(cols * (this.workH / this.workW)));
    while ((cols + 1) * (rows + 1) > 6800 && cols > 14) {
      cols -= 2;
      rows = Math.max(8, Math.round(cols * (this.workH / this.workW)));
    }
    this.sim = new SoftBody(cols, rows, this.workW, this.workH);
    const n = this.sim.count;
    this.pos = new Float32Array(n * 2);
    this.uv = new Float32Array(n * 2);
    this.wBuf = new Float32Array(n);
    this.rBuf = new Int16Array(n);
    this.fBuf = new Uint8Array(n);
    const nx = cols + 1;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const i = r * nx + c;
        this.uv[i * 2] = c / cols;
        this.uv[i * 2 + 1] = 1 - r / rows;
      }
    }
    const tris: number[] = [];
    const lines: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * nx + c;
        tris.push(i, i + 1, i + nx, i + 1, i + nx + 1, i + nx);
        lines.push(i, i + 1, i, i + nx);
      }
    }
    for (let c = 0; c < cols; c++) lines.push((rows) * nx + c, rows * nx + c + 1);
    for (let r = 0; r < rows; r++) lines.push(r * nx + cols, (r + 1) * nx + cols);
    this.indices = new Uint16Array(tris);
    this.lineIdx = new Uint16Array(lines);
    this.triCount = tris.length;
    this.weightsDirty = true;
    this.uploadStaticMesh(this.pipe);
    if (this.exportPipe && this.workCanvas) this.uploadImageTo(this.exportPipe, this.workCanvas);
  }

  private resample() {
    const sim = this.sim;
    if (!sim) return;
    this.weightsDirty = false;
    const params: PhysicsParams[] = [];
    this.order.forEach((id) => {
      const rec = this.regions.get(id);
      if (rec) params.push(rec.meta.params);
    });
    const nx = sim.cols + 1;
    for (let r = 0; r <= sim.rows; r++) {
      for (let c = 0; c <= sim.cols; c++) {
        const i = r * nx + c;
        const u = c / sim.cols;
        const v = r / sim.rows;
        let best = 0;
        let bestRegion = -1;
        let freeze = 0;
        for (let region = 0; region < this.order.length; region++) {
          const rec = this.regions.get(this.order[region]!);
          if (!rec?.meta.visible) continue;
          const value = this.sampleMask(rec.mask, u, v);
          if (value > best) {
            best = value;
            bestRegion = region;
            freeze = this.sampleMask(rec.freeze, u, v);
          }
        }
        this.wBuf[i] = bestRegion < 0 ? 0 : smoothstep(0.06, 0.5, best);
        this.rBuf[i] = bestRegion;
        this.fBuf[i] = freeze > 0.45 ? 1 : 0;
      }
    }
    sim.setMaps(this.wBuf, this.rBuf, this.fBuf, params);
  }

  private sampleMask(mask: Uint8Array, u: number, v: number) {
    if (!this.mw || mask.length !== this.mw * this.mh) return 0;
    const x = clamp(u, 0, 1) * (this.mw - 1);
    const y = clamp(v, 0, 1) * (this.mh - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(this.mw - 1, x0 + 1);
    const y1 = Math.min(this.mh - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const at = (px: number, py: number) => mask[py * this.mw + px] ?? 0;
    const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
    return (a + (b - a) * ty) / 255;
  }

  private uploadImage(canvas: HTMLCanvasElement) {
    if (!this.pipe) return;
    this.uploadImageTo(this.pipe, canvas);
    if (this.exportPipe) this.uploadImageTo(this.exportPipe, canvas);
  }

  private uploadImageTo(pipe: GlPipe, canvas: HTMLCanvasElement) {
    const gl = pipe.gl;
    gl.bindTexture(gl.TEXTURE_2D, pipe.image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadStaticMesh(pipe: GlPipe | null) {
    if (!pipe) return;
    const gl = pipe.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, pipe.uv);
    gl.bufferData(gl.ARRAY_BUFFER, this.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pipe.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pipe.lines);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.lineIdx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, pipe.pos);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
  }

  private uploadMesh(pipe: GlPipe, sx = 1, sy = 1) {
    this.uploadStaticMesh(pipe);
    this.writePositions(sx, sy);
    const gl = pipe.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, pipe.pos);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
  }

  private writePositions(sx = 1, sy = 1) {
    const sim = this.sim;
    if (!sim) return;
    for (let i = 0; i < sim.count; i++) {
      this.pos[i * 2] = sim.x[i]! * sx;
      this.pos[i * 2 + 1] = sim.y[i]! * sy;
    }
  }

  private rebuildOverlayTexture() {
    if (!this.pipe || !this.mw) return;
    const n = this.mw * this.mh;
    if (this.overlayPixels.length !== n * 4) this.overlayPixels = new Uint8Array(n * 4);
    const out = this.overlayPixels;
    out.fill(0);
    const opacity = this.brush.opacity / 100;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let rgb: [number, number, number] = [255, 122, 69];
      for (const id of this.order) {
        const rec = this.regions.get(id);
        if (!rec?.meta.visible) continue;
        const value = rec.mask[i] ?? 0;
        if (value > best) {
          best = value;
          rgb = hexToRgb(rec.meta.color);
        }
      }
      const o = i * 4;
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = Math.min(255, best * opacity);
    }
    const gl = this.pipe.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.pipe.mask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.mw, this.mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    this.overlayDirty = false;
  }

  private render() {
    if (this.overlayDirty && this.imageReady) this.rebuildOverlayTexture();
    if (this.sim && this.pipe) {
      this.writePositions();
      const gl = this.pipe.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pipe.pos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
      this.draw(
        this.pipe,
        this.originX,
        this.originY,
        this.zoom,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
        this.canvas.width,
        this.canvas.height,
        this.overlay,
      );
    } else if (this.pipe) {
      const gl = this.pipe.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.047, 0.055, 0.071, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.drawOverlay();
  }

  private draw(
    pipe: GlPipe,
    originX: number,
    originY: number,
    zoom: number,
    viewW: number,
    viewH: number,
    bufferW: number,
    bufferH: number,
    overlayOn: boolean,
  ) {
    const gl = pipe.gl;
    gl.viewport(0, 0, bufferW, bufferH);
    gl.clearColor(0.047, 0.055, 0.071, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.triCount) return;
    gl.useProgram(pipe.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, pipe.pos);
    gl.enableVertexAttribArray(pipe.aPos);
    gl.vertexAttribPointer(pipe.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pipe.uv);
    gl.enableVertexAttribArray(pipe.aUV);
    gl.vertexAttribPointer(pipe.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pipe.uOrigin, originX, originY);
    gl.uniform1f(pipe.uZoom, zoom);
    gl.uniform2f(pipe.uView, Math.max(1, viewW), Math.max(1, viewH));
    gl.uniform1f(pipe.uOverlay, overlayOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pipe.image);
    gl.uniform1i(pipe.uImage, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pipe.mask);
    gl.uniform1i(pipe.uMask, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pipe.idx);
    gl.drawElements(gl.TRIANGLES, this.triCount, gl.UNSIGNED_SHORT, 0);
    if (this.showMesh) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pipe.wire);
      gl.bindBuffer(gl.ARRAY_BUFFER, pipe.pos);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(pipe.wOrigin, originX, originY);
      gl.uniform1f(pipe.wZoom, zoom);
      gl.uniform2f(pipe.wView, Math.max(1, viewW), Math.max(1, viewH));
      gl.uniform4f(pipe.wColor, 0.24, 0.88, 0.69, 0.35);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pipe.lines);
      gl.drawElements(gl.LINES, this.lineIdx.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND);
    }
  }

  private drawOverlay() {
    const ctx = this.octx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    if (!this.imageReady) return;
    const dpr = this.dpr;
    if (this.polyImage.length) {
      ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr, -this.originX * this.zoom * dpr, -this.originY * this.zoom * dpr);
      ctx.beginPath();
      this.polyImage.forEach((point, index) => {
        if (index) ctx.lineTo(point.x, point.y);
        else ctx.moveTo(point.x, point.y);
      });
      ctx.strokeStyle = "#ff7a45";
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.stroke();
      for (const point of this.polyImage) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3.5 / this.zoom, 0, Math.PI * 2);
        ctx.fillStyle = "#ff7a45";
        ctx.fill();
      }
    }
    if (this.cursor && this.brushVisible()) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, this.brush.size / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(244,245,247,0.92)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private brushVisible() {
    return (
      this.tool === "soft" ||
      this.tool === "hard" ||
      this.tool === "eraser" ||
      this.tool === "smooth" ||
      this.tool === "freeze" ||
      this.tool === "jiggle" ||
      this.tool === "push" ||
      this.tool === "pull" ||
      this.tool === "restore"
    );
  }

  private emit() {
    if (this.emitQueued) return;
    this.emitQueued = true;
    requestAnimationFrame(() => {
      this.emitQueued = false;
      if (this.disposed) return;
      this.onChange?.(this.status());
    });
  }

  status(): EngineStatus {
    return {
      hasImage: this.imageReady,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      hasSelection: this.hasSelection,
      zoom: this.zoom,
      width: this.naturalW,
      height: this.naturalH,
    };
  }
}
