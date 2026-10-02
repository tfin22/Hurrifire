// Daily weather: cloud base and cover, haze, wind. Summer 1940 was mostly
// fine with fair-weather cumulus; some days brought low cloud and showers.

import { Vec3, DEG } from '../core/math';
import { Rng } from '../core/rng';

export interface DayWeather {
  cloudBase: number;
  cloudTop: number;
  cover: number;
  haze: number;
  /** Direction the wind blows FROM (deg) and its speed (m/s). */
  windFrom: number;
  windSpeed: number;
  summary: string;
}

export function windVector(w: DayWeather): Vec3 {
  // Wind blows from windFrom, i.e. towards windFrom + 180.
  const to = (w.windFrom + 180) * DEG;
  return new Vec3(Math.sin(to) * w.windSpeed, 0, Math.cos(to) * w.windSpeed);
}

export function generateWeather(rng: Rng, month: number): DayWeather {
  const r = rng.next();
  let cover: number, base: number, summary: string;
  if (r < 0.45) { cover = rng.range(0.1, 0.3); base = rng.range(1500, 2600); summary = 'Fine, scattered fair-weather cumulus'; }
  else if (r < 0.75) { cover = rng.range(0.3, 0.55); base = rng.range(1100, 2000); summary = 'Cumulus building in the afternoon'; }
  else if (r < 0.9) { cover = rng.range(0.55, 0.8); base = rng.range(700, 1400); summary = 'Cloudy, broken layer'; }
  else { cover = rng.range(0.02, 0.1); base = 2500; summary = 'Clear and hazy'; }
  if (month >= 10 && rng.chance(0.4)) { cover = Math.min(0.85, cover + 0.25); base -= 300; summary = 'Autumn cloud, showers about'; }
  const haze = rng.range(0.15, 0.55) + (summary.startsWith('Clear') ? 0.25 : 0);
  // Prevailing south-westerly to westerly.
  const windFrom = (220 + rng.gauss() * 45 + 360) % 360;
  const windSpeed = Math.max(1.5, rng.range(2, 9) + (month >= 10 ? 3 : 0));
  return { cloudBase: Math.round(base / 50) * 50, cloudTop: Math.round((base + rng.range(500, 1400)) / 50) * 50, cover, haze: Math.min(0.8, haze), windFrom, windSpeed, summary };
}

export function describeWind(w: DayWeather): string {
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const d = dirs[Math.round(w.windFrom / 45) % 8];
  const kt = Math.round(w.windSpeed * 1.944);
  return `Wind ${d} ${kt} knots`;
}
