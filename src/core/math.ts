// Small vector / quaternion / matrix library.
//
// Conventions used everywhere:
//   World:  x = east, y = up, z = north (metres).
//   Body:   x = right wing, y = up (canopy), z = forward (nose).
//   Camera: x = right, y = up, z = forward (depth).
// All three are the same handedness, so a body or camera frame is just a
// rotation of the world frame.

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  set(x: number, y: number, z: number): this {
    this.x = x; this.y = y; this.z = z;
    return this;
  }
  copy(v: Vec3): this {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }
  add(v: Vec3): this {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }
  sub(v: Vec3): this {
    this.x -= v.x; this.y -= v.y; this.z -= v.z;
    return this;
  }
  scale(s: number): this {
    this.x *= s; this.y *= s; this.z *= s;
    return this;
  }
  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
    return this;
  }
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  len(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  lenSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  normalize(): this {
    const l = this.len();
    if (l > 1e-12) this.scale(1 / l);
    return this;
  }
  /** this = a × b */
  crossOf(a: Vec3, b: Vec3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z;
    return this;
  }
  distTo(v: Vec3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  distSqTo(v: Vec3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  lerp(v: Vec3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
}

export const v3 = (x = 0, y = 0, z = 0) => new Vec3(x, y, z);
export const sub3 = (a: Vec3, b: Vec3) => new Vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const add3 = (a: Vec3, b: Vec3) => new Vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const cross3 = (a: Vec3, b: Vec3) => new Vec3().crossOf(a, b);

/** Unit quaternion (w, x, y, z). Rotates body vectors into world vectors. */
export class Quat {
  constructor(public w = 1, public x = 0, public y = 0, public z = 0) {}

  static fromAxisAngle(ax: Vec3, angle: number): Quat {
    const h = angle / 2, s = Math.sin(h);
    const l = ax.len() || 1;
    return new Quat(Math.cos(h), (ax.x / l) * s, (ax.y / l) * s, (ax.z / l) * s);
  }

  /** From heading (radians clockwise from north), pitch (up +), roll (right wing down +). */
  static fromEuler(heading: number, pitch: number, roll: number): Quat {
    // Apply roll about body z (right wing down = negative z-rotation), then pitch
    // about body x (nose up = negative x-rotation), then heading about world y
    // (a positive y-rotation turns north towards east, i.e. clockwise from above).
    const qh = Quat.fromAxisAngle(new Vec3(0, 1, 0), heading);
    const qp = Quat.fromAxisAngle(new Vec3(1, 0, 0), -pitch);
    const qr = Quat.fromAxisAngle(new Vec3(0, 0, 1), -roll);
    return qh.mul(qp).mul(qr).normalize();
  }

  copy(q: Quat): this {
    this.w = q.w; this.x = q.x; this.y = q.y; this.z = q.z;
    return this;
  }
  clone(): Quat {
    return new Quat(this.w, this.x, this.y, this.z);
  }
  /** Returns this * q (apply q first, then this). */
  mul(q: Quat): Quat {
    return new Quat(
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
    );
  }
  normalize(): this {
    const l = Math.hypot(this.w, this.x, this.y, this.z) || 1;
    this.w /= l; this.x /= l; this.y /= l; this.z /= l;
    return this;
  }
  conj(): Quat {
    return new Quat(this.w, -this.x, -this.y, -this.z);
  }
  /** Rotate v (body) into out (world). */
  rotate(v: Vec3, out = new Vec3()): Vec3 {
    return rotateBy(this.w, this.x, this.y, this.z, v, out);
  }
  /** Rotate world vector into body frame. */
  unrotate(v: Vec3, out = new Vec3()): Vec3 {
    return rotateBy(this.w, -this.x, -this.y, -this.z, v, out);
  }
  /** Integrate body angular rates (rad/s about body x, y, z) over dt. */
  integrateBody(wx: number, wy: number, wz: number, dt: number): this {
    const ang = Math.sqrt(wx * wx + wy * wy + wz * wz) * dt;
    if (ang < 1e-12) return this;
    const h = ang / 2, sn = Math.sin(h);
    const l = Math.hypot(wx, wy, wz) || 1;
    const qw = Math.cos(h), qx = (wx / l) * sn, qy = (wy / l) * sn, qz = (wz / l) * sn;
    const { w, x, y, z } = this;
    this.w = w * qw - x * qx - y * qy - z * qz;
    this.x = w * qx + x * qw + y * qz - z * qy;
    this.y = w * qy - x * qz + y * qw + z * qx;
    this.z = w * qz + x * qy - y * qx + z * qw;
    return this.normalize();
  }
  /** Fill a row-major 3x3 matrix whose columns are the body axes in world space. */
  toMat3(m: Float64Array | number[] = new Float64Array(9)): Float64Array | number[] {
    const { w, x, y, z } = this;
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
    m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
    m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
    return m;
  }
  static slerp(a: Quat, b: Quat, t: number): Quat {
    let cos = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    let bw = b.w, bx = b.x, by = b.y, bz = b.z;
    if (cos < 0) { cos = -cos; bw = -bw; bx = -bx; by = -by; bz = -bz; }
    if (cos > 0.9995) {
      return new Quat(a.w + (bw - a.w) * t, a.x + (bx - a.x) * t, a.y + (by - a.y) * t, a.z + (bz - a.z) * t).normalize();
    }
    const th = Math.acos(cos), s = Math.sin(th);
    const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
    return new Quat(a.w * ka + bw * kb, a.x * ka + bx * kb, a.y * ka + by * kb, a.z * ka + bz * kb);
  }
  /** Quaternion whose body z points along fwd and body y is as close as possible to up. */
  static lookRotation(fwd: Vec3, up: Vec3 = new Vec3(0, 1, 0)): Quat {
    const f = fwd.clone().normalize();
    let r = cross3(up, f);
    if (r.lenSq() < 1e-9) r = cross3(new Vec3(0, 0, 1), f);
    r.normalize();
    const u = cross3(f, r);
    return Quat.fromBasis(r, u, f);
  }
  /** From orthonormal basis columns (right, up, forward). */
  static fromBasis(r: Vec3, u: Vec3, f: Vec3): Quat {
    const m00 = r.x, m01 = u.x, m02 = f.x;
    const m10 = r.y, m11 = u.y, m12 = f.y;
    const m20 = r.z, m21 = u.z, m22 = f.z;
    const tr = m00 + m11 + m22;
    let q: Quat;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      q = new Quat(0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s);
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      q = new Quat((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s);
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      q = new Quat((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s);
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      q = new Quat((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s);
    }
    return q.normalize();
  }
}

function rotateBy(w: number, x: number, y: number, z: number, v: Vec3, out: Vec3): Vec3 {
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  out.x = ix * w + iw * -x + iy * -z - iz * -y;
  out.y = iy * w + iw * -y + iz * -x - ix * -z;
  out.z = iz * w + iw * -z + ix * -y - iy * -x;
  return out;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Compass heading (0 = north, clockwise, radians in [0, 2PI)) of a world direction. */
export function headingOf(dx: number, dz: number): number {
  let h = Math.atan2(dx, dz);
  if (h < 0) h += 2 * Math.PI;
  return h;
}

/** Move value toward target by at most maxDelta. */
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

// Unit conversions — the sim works in SI; the cockpit speaks imperial.
export const MPS_TO_MPH = 2.236936;
export const MPH_TO_MPS = 1 / MPS_TO_MPH;
export const M_TO_FT = 3.28084;
export const FT_TO_M = 1 / M_TO_FT;
export const YD_TO_M = 0.9144;
export const G = 9.81;

/** ISA air density (kg/m^3) at altitude in metres. */
export function airDensity(h: number): number {
  const hh = Math.max(0, Math.min(h, 11000));
  const T = 288.15 - 0.0065 * hh;
  return 1.225 * Math.pow(T / 288.15, 4.2559);
}
