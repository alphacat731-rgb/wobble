export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blurAxis(
  src: Uint8Array,
  dst: Uint8Array,
  w: number,
  h: number,
  radius: number,
  vertical: boolean,
) {
  const r = Math.max(0, radius | 0);
  const win = r * 2 + 1;
  if (r === 0) {
    dst.set(src);
    return;
  }
  if (!vertical) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + clamp(k, 0, w - 1)]!;
      for (let x = 0; x < w; x++) {
        dst[row + x] = (sum / win) | 0;
        const remove = src[row + clamp(x - r, 0, w - 1)]!;
        const add = src[row + clamp(x + r + 1, 0, w - 1)]!;
        sum += add - remove;
      }
    }
    return;
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[clamp(k, 0, h - 1) * w + x]!;
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = (sum / win) | 0;
      const remove = src[clamp(y - r, 0, h - 1) * w + x]!;
      const add = src[clamp(y + r + 1, 0, h - 1) * w + x]!;
      sum += add - remove;
    }
  }
}

export function boxBlur(src: Uint8Array, w: number, h: number, radius: number, passes = 2) {
  if (radius < 1) return src.slice();
  const a = new Uint8Array(src.length);
  const b = new Uint8Array(src.length);
  let cur = src;
  for (let p = 0; p < passes; p++) {
    blurAxis(cur, a, w, h, radius, false);
    blurAxis(a, b, w, h, radius, true);
    cur = b;
  }
  return cur === src ? src.slice() : cur.slice();
}

export function stampBrush(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
  softness: number,
  add: boolean,
  hard: boolean,
) {
  const r = Math.max(0.75, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const soft = hard ? Math.min(0.4, softness * 0.4) : clamp(0.2 + softness * 0.8, 0, 1);
  const inner = r * (1 - soft);
  const span = Math.max(0.001, r - inner);
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      let a = 1;
      if (d > inner) {
        const t = (d - inner) / span;
        const s = 1 - t;
        a = s * s * (3 - 2 * s);
      }
      a *= strength;
      const i = y * w + x;
      const prev = mask[i]!;
      mask[i] = add ? Math.min(255, prev + a * (255 - prev)) : Math.max(0, prev * (1 - a));
    }
  }
}

export function fillPolygon(points: { x: number; y: number }[], w: number, h: number) {
  const temp = new Uint8Array(w * h);
  if (points.length < 3) return temp;
  for (let y = 0; y < h; y++) {
    const nodes: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j]!;
      const b = points[i]!;
      if (a.y < y && b.y >= y || b.y < y && a.y >= y) {
        const t = (y - a.y) / (b.y - a.y);
        nodes.push(a.x + (b.x - a.x) * t);
      }
    }
    nodes.sort((p, q) => p - q);
    for (let k = 0; k + 1 < nodes.length; k += 2) {
      let x0 = Math.ceil(nodes[k]!);
      let x1 = Math.floor(nodes[k + 1]!);
      if (x1 < x0) continue;
      x0 = clamp(x0, 0, w - 1);
      x1 = clamp(x1, 0, w - 1);
      const row = y * w;
      for (let x = x0; x <= x1; x++) temp[row + x] = 255;
    }
  }
  return temp;
}

export function compositeMax(mask: Uint8Array, src: Uint8Array, add: boolean, strength: number) {
  const gain = clamp(strength, 0, 1);
  for (let i = 0; i < mask.length; i++) {
    const a = (src[i]! / 255) * gain;
    if (a <= 0) continue;
    const prev = mask[i]!;
    mask[i] = add ? Math.min(255, Math.max(prev, src[i]! * gain)) : Math.max(0, prev * (1 - a));
  }
}

export function floodFill(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
) {
  const temp = new Uint8Array(w * h);
  const x = clamp(sx | 0, 0, w - 1);
  const y = clamp(sy | 0, 0, h - 1);
  const start = y * w + x;
  const tr = pixels[start * 4]!;
  const tg = pixels[start * 4 + 1]!;
  const tb = pixels[start * 4 + 2]!;
  const tol = tolerance * tolerance;
  const seen = new Uint8Array(w * h);
  const stack = [start];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const r = pixels[p * 4]! - tr;
    const g = pixels[p * 4 + 1]! - tg;
    const b = pixels[p * 4 + 2]! - tb;
    if (r * r + g * g + b * b > tol) continue;
    temp[p] = 255;
    const px = p % w;
    const py = (p / w) | 0;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }
  return temp;
}

export function smoothBrush(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
) {
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const src = mask.slice();
  const n = 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      let sum = 0;
      let count = 0;
      const iy0 = Math.max(0, y - n);
      const iy1 = Math.min(h - 1, y + n);
      const ix0 = Math.max(0, x - n);
      const ix1 = Math.min(w - 1, x + n);
      for (let yy = iy0; yy <= iy1; yy++) {
        const row = yy * w;
        for (let xx = ix0; xx <= ix1; xx++) {
          sum += src[row + xx]!;
          count++;
        }
      }
      const avg = sum / count;
      const fall = 1 - d / r;
      const t = fall * fall * strength;
      const i = y * w + x;
      mask[i] = mask[i]! * (1 - t) + avg * t;
    }
  }
}

export function maskHasInk(mask: Uint8Array) {
  for (let i = 0; i < mask.length; i += 13) {
    if (mask[i]! > 12) return true;
  }
  return false;
}
