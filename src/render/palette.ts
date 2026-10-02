// The 32-colour palette, each entry 12-bit RGB (4 bits per channel) as on the
// Amiga's 4096-colour range. Indices 32..255 of the 8-bit framebuffer are not
// palette colours: they are the "copper" sky/ground gradient, rewritten every
// frame (see copper.ts), and so do not count against the 32.

export const C = {
  BLACK: 0,
  WHITE: 1,
  RAF_GREEN_D: 2,
  RAF_GREEN: 3,
  RAF_GREEN_L: 4,
  RAF_EARTH_D: 5,
  RAF_EARTH: 6,
  RAF_EARTH_L: 7,
  SKY_D: 8,
  SKY_L: 9,
  LW_D: 10,
  LW_M: 11,
  LW_L: 12,
  HAZE: 13, // doubles as RLM 65 light blue in shade
  LW_BLUE: 14,
  FIELD_D: 15,
  FIELD: 16,
  FIELD_L: 17,
  GOLD: 18,
  STUBBLE: 19,
  SEA_D: 20,
  SEA: 21,
  CHALK: 22,
  GREY_D: 23,
  GREY_L: 24,
  FIRE_R: 25,
  FIRE_Y: 26,
  SMOKE: 27,
  PANEL: 28,
  SIGHT: 29,
  RED: 30,
  BLUE: 31,
} as const;

/** 12-bit RGB, 0xRGB. */
export const PALETTE_12: readonly number[] = [
  0x000, // BLACK
  0xfff, // WHITE
  0x231, // RAF dark green (shade)
  0x352, // RAF dark green
  0x573, // RAF dark green (lit)
  0x421, // RAF dark earth (shade) / ploughed soil
  0x643, // RAF dark earth
  0x865, // RAF dark earth (lit)
  0x9a9, // sky (duck egg) shade
  0xcdb, // sky (duck egg) lit
  0x344, // RLM 71/02 shade
  0x566, // RLM 71/02
  0x788, // RLM 02 lit
  0x9ab, // haze / RLM 65 shade
  0xbcd, // RLM 65 light blue
  0x241, // field green shade / woodland
  0x462, // field green
  0x683, // field green lit / pasture
  0xa93, // harvest gold
  0xcb6, // stubble
  0x247, // sea shade
  0x469, // sea
  0xddc, // chalk / cloud
  0x555, // town dark grey
  0x888, // town light grey / cloud shadow
  0xe40, // fire red-orange
  0xfd3, // fire yellow / 109 cowling yellow
  0x333, // smoke / canopy frame
  0x454, // cockpit interior grey-green
  0xfa5, // gunsight glow
  0xc22, // roundel red
  0x239, // roundel blue
];

export const NUM_COLOURS = 32;
export const COPPER_BASE = 32;
export const COPPER_COUNT = 224;

export function rgb12to24(c: number): [number, number, number] {
  return [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17];
}

/** Quantise a 0..255 channel triple to 12-bit, as the Amiga would. */
export function quant12(r: number, g: number, b: number): [number, number, number] {
  const q = (v: number) => Math.max(0, Math.min(15, Math.round(v / 17))) * 17;
  return [q(r), q(g), q(b)];
}

/**
 * A material is a shading ramp of palette indices, darkest to lightest.
 * Flat shading picks a step by the face's angle to the sun; distance fog then
 * steps further up the ramp and finally to HAZE — no blending.
 */
export interface Material {
  ramp: readonly number[];
  /** If true, ignore lighting (roundels, markings, glows). */
  unlit?: boolean;
  /** If true, never fogged (cockpit). */
  noFog?: boolean;
}

export const MAT = {
  rafGreen: { ramp: [C.RAF_GREEN_D, C.RAF_GREEN, C.RAF_GREEN_L] },
  rafEarth: { ramp: [C.RAF_EARTH_D, C.RAF_EARTH, C.RAF_EARTH_L] },
  rafSky: { ramp: [C.GREY_L, C.SKY_D, C.SKY_L] },
  lwUpper: { ramp: [C.LW_D, C.LW_M, C.LW_L] },
  lwUnder: { ramp: [C.LW_L, C.HAZE, C.LW_BLUE] },
  lwBomber: { ramp: [C.FIELD_D, C.LW_D, C.LW_M] },
  black: { ramp: [C.BLACK, C.SMOKE, C.GREY_D] },
  white: { ramp: [C.GREY_L, C.CHALK, C.WHITE] },
  yellow: { ramp: [C.GOLD, C.FIRE_Y, C.FIRE_Y] },
  red: { ramp: [C.RED], unlit: true },
  blue: { ramp: [C.BLUE], unlit: true },
  roundelYellow: { ramp: [C.FIRE_Y], unlit: true },
  glass: { ramp: [C.SMOKE, C.GREY_D, C.HAZE] },
  metal: { ramp: [C.BLACK, C.SMOKE, C.GREY_D] },
  field: { ramp: [C.FIELD_D, C.FIELD, C.FIELD_L] },
  wood: { ramp: [C.FIELD_D, C.FIELD_D, C.FIELD] },
  gold: { ramp: [C.RAF_EARTH_L, C.GOLD, C.STUBBLE] },
  stubble: { ramp: [C.GOLD, C.STUBBLE, C.CHALK] },
  plough: { ramp: [C.RAF_EARTH_D, C.RAF_EARTH, C.RAF_EARTH_L] },
  // Sea stays sea through the near fog bands (a three-step ramp went to haze at the first).
  sea: { ramp: [C.SEA_D, C.SEA, C.SEA] },
  chalk: { ramp: [C.GREY_L, C.CHALK, C.WHITE] },
  town: { ramp: [C.SMOKE, C.GREY_D, C.GREY_L] },
  roof: { ramp: [C.RAF_EARTH_D, C.RAF_EARTH, C.RED] },
  cloud: { ramp: [C.GREY_L, C.CHALK, C.WHITE] },
  cloudBase: { ramp: [C.GREY_D, C.GREY_L, C.GREY_L] },
  fire: { ramp: [C.FIRE_R, C.FIRE_Y], unlit: true },
  smoke: { ramp: [C.SMOKE, C.GREY_D, C.GREY_L] },
  panel: { ramp: [C.PANEL], unlit: true, noFog: true },
  balloon: { ramp: [C.GREY_D, C.GREY_L, C.CHALK] },
  crosses: { ramp: [C.BLACK], unlit: true },
  pasture: { ramp: [C.FIELD, C.FIELD_L, C.FIELD_L] },
  downs: { ramp: [C.FIELD_L, C.FIELD_L, C.STUBBLE] },
  marsh: { ramp: [C.FIELD_D, C.FIELD, C.SKY_D] },
  city: { ramp: [C.SMOKE, C.GREY_D, C.GREY_D] },
  river: { ramp: [C.SEA_D, C.SEA_D, C.SEA] },
  mud: { ramp: [C.RAF_EARTH, C.RAF_EARTH_L, C.GREY_L] },
  beach: { ramp: [C.GREY_L, C.STUBBLE, C.CHALK] },
  airfield: { ramp: [C.FIELD, C.FIELD_L, C.FIELD_L] },
} satisfies Record<string, Material>;

export type MaterialName = keyof typeof MAT;
export const MATERIAL_NAMES = Object.keys(MAT) as MaterialName[];
export const MATERIAL_LIST: Material[] = MATERIAL_NAMES.map((k) => MAT[k]);
export const MAT_ID: Record<MaterialName, number> = Object.fromEntries(
  MATERIAL_NAMES.map((k, i) => [k, i]),
) as Record<MaterialName, number>;

/**
 * Shade + fog lookup. light in [0,1] is the lit fraction; fog is 0 (none) to 3
 * (gone to haze). Returns a palette index.
 */
export function shadeIndex(mat: Material, light: number, fog: number): number {
  const ramp = mat.ramp;
  const n = ramp.length;
  let step = mat.unlit ? n - 1 : Math.min(n - 1, Math.max(0, Math.floor(light * n)));
  if (mat.noFog || fog <= 0) return ramp[step];
  if (fog >= 3) return C.HAZE;
  // Each fog band steps one place up the ramp, stopping at its lightest
  // entry; only the last band goes to haze. Patchwork survives into the
  // distance, just paler.
  return ramp[Math.min(n - 1, step + fog)];
}
