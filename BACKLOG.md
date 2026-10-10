# Backlog

Possible changes, not yet started. Done work is written up in
DECISIONS.md.

## Cockpits for each type

Playtest: "Maybe different instrument view for Spit v Hurricane v 109."

Today all three share one panel (`src/render/cockpit.ts`). The only
difference is the 109's red low-fuel lamp.
- **Hurricane and Spitfire.** Both carried the RAF's standard Blind Flying
  Panel (the "basic six") in the middle, so the differences are around it:
  - the panel's shape and colour;
  - where the boost, rpm, temperature and fuel gauges sit;
  - the Spitfire's undercarriage pump handle and indicator;
  - the Hurricane's deeper, roomier cockpit and heavier canopy framing.
- **Bf 109.** Quite different:
  - metric instruments (km/h, metres, ata boost);
  - a different layout, the Revi gunsight and its armoured glass;
  - the cramped, heavily framed canopy.

## Controls and help
- **Point-and-fly on phones:** drag where you want the nose to go, and the
  aircraft flies there.
- **A tutorial:** a first flight that walks through start-up, take-off,
  turning, landing and the guns.
- **The manual from the pause menu** in flight, as well as the title
  menu.
- **A large-text option** for the small font.
- **Settings presets** ("relaxed", "authentic") alongside the single
  options.

## Content
- **More missions:** more "The Other Side" sorties (Stukas, the 110s),
  convoys, night alerts.
- **Saves:** export and import the campaign and logbook, to move them
  between devices.

## Under the bonnet
- **CI:** GitHub Actions running the typecheck, tests and build on each
  PR.
- **Large files:** split the biggest (`sortie.ts`, `flight.ts`,
  `screens/flight.ts`) into smaller pieces.
- **A split build** (separate JS and assets instead of one HTML file).
  Deferred: "Future option but not now."
