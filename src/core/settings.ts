// Player settings, persisted separately from the campaign save.

export interface Settings {
  /** Assist adds lead indicator, spotting markers, glide ring, approach aid, one-button start. */
  assist: boolean;
  /** Optional ammunition bar on the HUD (forced off in Authentic). */
  ammoBar: boolean;
  autoRudder: boolean;
  tilt: boolean;
  haptics: boolean;
  /** "1990 mode": 12.5 fps render, one detail level down. */
  retro: boolean;
  sound: number;
  music: boolean;
  /** Collapsed instrument panel (slim strip). */
  slimPanel: boolean;
  convergenceYards: number;
  sightSpanFt: number;
  /** Enemy markers: formations far off, individual aircraft close in, an arrow to the nearest. */
  markers: boolean;
  /** Large airspeed and height readouts (the dials are too small on a phone). */
  bigReadouts: boolean;
}

const KEY = 'scramble.settings.v1';

export const defaultSettings = (): Settings => ({
  assist: true,
  ammoBar: false,
  autoRudder: true,
  tilt: false,
  haptics: true,
  retro: false,
  sound: 0.8,
  music: true,
  slimPanel: false,
  convergenceYards: 300,
  sightSpanFt: 32,
  markers: true,
  bigReadouts: true,
});

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    /* private mode etc. */
  }
  return defaultSettings();
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
