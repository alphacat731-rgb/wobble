import type { PhysicsParams } from "@/lib/jiggle/types";
import { lerp } from "@/lib/jiggle/mask";

export type Derived = {
  anchor: number;
  stiff: number;
  shear: number;
  damp: number;
  gravity: number;
  deform: number;
  maxDisp: number;
  grab: number;
  bounce: number;
  mass: number;
};

export function derive(params: PhysicsParams, unit: number): Derived {
  const e = params.elasticity / 100;
  const mass = lerp(0.45, 2.8, params.mass / 100);
  return {
    anchor: lerp(8, 160, params.recovery / 100) * lerp(0.82, 1.18, e),
    stiff: lerp(36, 480, params.stiffness / 100),
    shear: lerp(20, 300, params.stiffness / 100),
    damp: lerp(1.7, 16, params.damping / 100) * lerp(1.28, 0.6, e),
    gravity: lerp(0, 1500, params.gravity / 100) * unit,
    deform: lerp(0.12, 1.42, params.deform / 100),
    maxDisp: lerp(0.03, 0.5, params.maxDisp / 100) * unit * 1000,
    grab: 148,
    bounce: lerp(90, 1500, params.bounce / 100) * unit,
    mass,
  };
}

export class SoftBody {
  readonly cols: number;
  readonly rows: number;
  readonly imgW: number;
  readonly imgH: number;
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly rx: Float32Array;
  readonly ry: Float32Array;
  readonly w = new Float32Array(0);
  readonly region: Int16Array;
  readonly frozen: Uint8Array;
  readonly invMass: Float32Array;
  readonly border: Uint8Array;

  private readonly si: Uint16Array;
  private readonly sj: Uint16Array;
  private readonly srest: Float32Array;
  private readonly skind: Uint8Array;
  private readonly springCount: number;
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;
  private readonly grabFall: Float32Array;
  private params: PhysicsParams[] = [];
  private derived: Derived[] = [];
  private grabbing = false;
  private grabRegion = -1;
  private grabDX = 0;
  private grabDY = 0;

  constructor(cols: number, rows: number, imgW: number, imgH: number) {
    this.cols = cols;
    this.rows = rows;
    this.imgW = imgW;
    this.imgH = imgH;
    const nx = cols + 1;
    const ny = rows + 1;
    const n = nx * ny;
    this.count = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    this.w = new Float32Array(n);
    this.region = new Int16Array(n);
    this.region.fill(-1);
    this.frozen = new Uint8Array(n);
    this.invMass = new Float32Array(n);
    this.border = new Uint8Array(n);
    this.ax = new Float32Array(n);
    this.ay = new Float32Array(n);
    this.grabFall = new Float32Array(n);

    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const i = r * nx + c;
        const px = (c / cols) * imgW;
        const py = (r / rows) * imgH;
        this.rx[i] = px;
        this.ry[i] = py;
        this.x[i] = px;
        this.y[i] = py;
        this.border[i] = c === 0 || r === 0 || c === cols || r === rows ? 1 : 0;
      }
    }

    const pairs: number[] = [];
    const kinds: number[] = [];
    const add = (a: number, b: number, shear: number) => {
      pairs.push(a, b);
      kinds.push(shear);
    };
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const i = r * nx + c;
        if (c + 1 < nx) add(i, i + 1, 0);
        if (r + 1 < ny) add(i, i + nx, 0);
        if (c + 1 < nx && r + 1 < ny) {
          add(i, i + nx + 1, 1);
          add(i + 1, i + nx, 1);
        }
      }
    }
    const m = kinds.length;
    this.springCount = m;
    this.si = new Uint16Array(m);
    this.sj = new Uint16Array(m);
    this.srest = new Float32Array(m);
    this.skind = new Uint8Array(m);
    for (let s = 0; s < m; s++) {
      const a = pairs[s * 2]!;
      const b = pairs[s * 2 + 1]!;
      this.si[s] = a;
      this.sj[s] = b;
      this.skind[s] = kinds[s]!;
      const dx = this.rx[a]! - this.rx[b]!;
      const dy = this.ry[a]! - this.ry[b]!;
      this.srest[s] = Math.hypot(dx, dy) || 1;
    }
  }

  setMaps(weight: Float32Array, region: Int16Array, frozen: Uint8Array, params: PhysicsParams[]) {
    this.w.set(weight);
    this.region.set(region);
    this.frozen.set(frozen);
    this.params = params;
    this.refreshDerived();
    for (let i = 0; i < this.count; i++) {
      const reg = this.region[i]!;
      const ww = this.w[i]!;
      let next = 0;
      if (!this.border[i] && !this.frozen[i] && ww >= 0.035 && reg >= 0) {
        const mass = this.derived[reg]?.mass ?? 1;
        next = ww / mass;
      }
      if (next === 0) {
        this.x[i] = this.rx[i]!;
        this.y[i] = this.ry[i]!;
        this.vx[i] = 0;
        this.vy[i] = 0;
        this.grabFall[i] = 0;
      }
      this.invMass[i] = next;
    }
  }

  private refreshDerived() {
    const unit = this.imgW / 1000;
    this.derived = this.params.map((params) => derive(params, unit));
  }

  step(dt: number) {
    if (!(dt > 0)) return;
    this.refreshDerived();
    const h = Math.min(dt, 0.033) / 4;
    for (let s = 0; s < 4; s++) this.integrate(h);
  }

  private integrate(h: number) {
    const n = this.count;
    const ax = this.ax;
    const ay = this.ay;
    for (let i = 0; i < n; i++) {
      const im = this.invMass[i]!;
      const reg = this.region[i]!;
      const d = im === 0 ? undefined : this.derived[reg];
      if (im === 0 || !d) {
        ax[i] = 0;
        ay[i] = 0;
        continue;
      }
      const ww = this.w[i]!;
      const edge = 1 - ww;
      const kA = d.anchor * (0.42 + 2.7 * edge * edge);
      ax[i] = (this.rx[i]! - this.x[i]!) * kA * im;
      ay[i] = (this.ry[i]! - this.y[i]!) * kA * im + d.gravity;
    }

    if (this.grabbing) {
      const d = this.derived[this.grabRegion];
      if (d) {
        const gdx = this.grabDX;
        const gdy = this.grabDY;
        for (let i = 0; i < n; i++) {
          const fall = this.grabFall[i]!;
          if (fall <= 0 || this.invMass[i] === 0) continue;
          const tx = this.rx[i]! + gdx * fall * d.deform;
          const ty = this.ry[i]! + gdy * fall * d.deform;
          const follow = d.grab * this.w[i]!;
          ax[i]! += (tx - this.x[i]!) * follow;
          ay[i]! += (ty - this.y[i]!) * follow;
        }
      }
    }

    for (let s = 0; s < this.springCount; s++) {
      const i = this.si[s]!;
      const j = this.sj[s]!;
      const imI = this.invMass[i]!;
      const imJ = this.invMass[j]!;
      if (imI === 0 && imJ === 0) continue;
      if (imI > 0 && imJ > 0 && this.region[i] !== this.region[j]) continue;
      const reg = imI > 0 ? this.region[i]! : this.region[j]!;
      const d = this.derived[reg];
      if (!d) continue;
      const dx = this.x[j]! - this.x[i]!;
      const dy = this.y[j]! - this.y[i]!;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const dirx = dx / dist;
      const diry = dy / dist;
      const rest = this.srest[s]!;
      let stretch = dist - rest;
      const limit = rest * 1.35;
      if (stretch > limit) stretch = limit;
      else if (stretch < -rest * 0.8) stretch = -rest * 0.8;
      const rel = (this.vx[j]! - this.vx[i]!) * dirx + (this.vy[j]! - this.vy[i]!) * diry;
      const k = this.skind[s] ? d.shear : d.stiff;
      let f = k * stretch + k * 0.06 * rel;
      if (f > 9000) f = 9000;
      else if (f < -9000) f = -9000;
      ax[i]! += dirx * f * imI;
      ay[i]! += diry * f * imI;
      ax[j]! -= dirx * f * imJ;
      ay[j]! -= diry * f * imJ;
    }

    const vmax = this.imgW * 2.4;
    for (let i = 0; i < n; i++) {
      if (this.invMass[i] === 0) {
        this.x[i] = this.rx[i]!;
        this.y[i] = this.ry[i]!;
        this.vx[i] = 0;
        this.vy[i] = 0;
        continue;
      }
      const d = this.derived[this.region[i]!]!;
      let vx = (this.vx[i]! + ax[i]! * h) * Math.exp(-d.damp * h);
      let vy = (this.vy[i]! + ay[i]! * h) * Math.exp(-d.damp * h);
      const sp = Math.hypot(vx, vy);
      if (sp > vmax) {
        const s = vmax / sp;
        vx *= s;
        vy *= s;
      }
      let x = this.x[i]! + vx * h;
      let y = this.y[i]! + vy * h;
      let dx = x - this.rx[i]!;
      let dy = y - this.ry[i]!;
      const dist = Math.hypot(dx, dy);
      const maxD = d.maxDisp;
      if (dist > maxD && dist > 0) {
        const s = maxD / dist;
        x = this.rx[i]! + dx * s;
        y = this.ry[i]! + dy * s;
        const vn = (vx * dx + vy * dy) / (dist * dist);
        if (vn > 0) {
          vx -= vn * dx;
          vy -= vn * dy;
        }
        dx = x - this.rx[i]!;
        dy = y - this.ry[i]!;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        x = this.rx[i]!;
        y = this.ry[i]!;
        vx = 0;
        vy = 0;
      }
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = vx;
      this.vy[i] = vy;
    }
  }

  beginGrab(ix: number, iy: number, region: number, radius: number) {
    this.grabFall.fill(0);
    const r = Math.max(12, radius);
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.region[i] !== region || this.invMass[i] === 0) continue;
      const dx = this.rx[i]! - ix;
      const dy = this.ry[i]! - iy;
      const dist = Math.hypot(dx, dy);
      if (dist > r) continue;
      const t = 1 - dist / r;
      this.grabFall[i] = t * t * (3 - 2 * t);
      any = true;
    }
    this.grabbing = any;
    this.grabRegion = region;
    this.grabDX = 0;
    this.grabDY = 0;
    return any;
  }

  updateGrab(dx: number, dy: number) {
    const d = this.derived[this.grabRegion];
    const maxD = d?.maxDisp ?? Infinity;
    const dist = Math.hypot(dx, dy);
    if (dist > maxD && dist > 0) {
      const s = maxD / dist;
      this.grabDX = dx * s;
      this.grabDY = dy * s;
    } else {
      this.grabDX = dx;
      this.grabDY = dy;
    }
  }

  endGrab() {
    this.grabbing = false;
    this.grabFall.fill(0);
  }

  get isGrabbing() {
    return this.grabbing;
  }

  tap(ix: number, iy: number, region: number, radius: number) {
    const d = this.derived[region];
    if (!d) return;
    const impulse = d.bounce;
    for (let i = 0; i < this.count; i++) {
      if (this.region[i] !== region || this.invMass[i] === 0) continue;
      const dx = this.x[i]! - ix;
      const dy = this.y[i]! - iy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const fall = (1 - dist / radius) ** 2 * this.w[i]!;
      const len = dist || 1;
      this.vx[i]! += (dx / len * 0.55 + 0.12) * impulse * fall;
      this.vy[i]! += (dy / len * 0.35 - 0.95) * impulse * fall;
    }
  }

  accelerate(ax: number, ay: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      this.vx[i]! += ax * this.w[i]!;
      this.vy[i]! += ay * this.w[i]!;
    }
  }

  applyBrush(
    kind: "jiggle" | "push" | "pull" | "restore",
    ix: number,
    iy: number,
    radius: number,
    power: number,
    region: number,
    time: number,
  ) {
    const r = Math.max(4, radius);
    for (let i = 0; i < this.count; i++) {
      if (region >= 0 && this.region[i] !== region) continue;
      if (this.invMass[i] === 0) continue;
      const dx = this.x[i]! - ix;
      const dy = this.y[i]! - iy;
      const dist = Math.hypot(dx, dy);
      if (dist > r) continue;
      const fall = (1 - dist / r) ** 2;
      const len = dist || 1;
      const f = power * fall * this.w[i]!;
      if (kind === "push") {
        this.vx[i]! += (dx / len) * f;
        this.vy[i]! += (dy / len) * f;
      } else if (kind === "pull") {
        this.vx[i]! -= (dx / len) * f;
        this.vy[i]! -= (dy / len) * f;
      } else if (kind === "jiggle") {
        const wob = Math.sin(time * 0.028 + i * 0.35);
        this.vx[i]! += Math.cos(time * 0.02 + i) * f * 0.85;
        this.vy[i]! += wob * f;
      } else {
        this.vx[i]! += (this.rx[i]! - this.x[i]!) * f * 0.08;
        this.vy[i]! += (this.ry[i]! - this.y[i]!) * f * 0.08;
        this.vx[i]! *= 0.8;
        this.vy[i]! *= 0.8;
      }
    }
  }

  resetRegion(region: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.region[i] !== region) continue;
      this.x[i] = this.rx[i]!;
      this.y[i] = this.ry[i]!;
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    if (this.grabRegion === region) this.endGrab();
  }

  maxOffset(region = -1) {
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      if (region >= 0 && this.region[i] !== region) continue;
      const d = Math.hypot(this.x[i]! - this.rx[i]!, this.y[i]! - this.ry[i]!);
      if (d > m) m = d;
    }
    return m;
  }

  dynamicCount(region = -1) {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      if (region >= 0 && this.region[i] !== region) continue;
      n++;
    }
    return n;
  }
}
