// What the simulation needs to know about the ground: height and surface.
// Implemented by the world map (content/world) and by test terrains.

export type Surface =
  | 'airfield' | 'pasture' | 'stubble' | 'ploughed' | 'marsh' | 'orchard'
  | 'woodland' | 'hops' | 'town' | 'beach' | 'sea' | 'water' | 'chalk';

export interface GroundModel {
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
}

/** Rolling friction by surface (wheels), and whether it's soft (nose-over risk). */
export const SURFACE_FRICTION: Record<Surface, { friction: number; soft: boolean }> = {
  airfield: { friction: 0.05, soft: false },
  pasture: { friction: 0.07, soft: false },
  stubble: { friction: 0.08, soft: false },
  ploughed: { friction: 0.2, soft: true },
  marsh: { friction: 0.25, soft: true },
  orchard: { friction: 0.15, soft: false },
  woodland: { friction: 0.3, soft: true },
  hops: { friction: 0.15, soft: false },
  town: { friction: 0.1, soft: false },
  beach: { friction: 0.12, soft: true },
  sea: { friction: 0.6, soft: true },
  water: { friction: 0.6, soft: true },
  chalk: { friction: 0.1, soft: false },
};
