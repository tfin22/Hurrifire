# Design decisions

Where the spec was ambiguous, or where I took a liberty, it's noted here.

## Platform and build

- **Single file plus optional PWA extras.** `npm run build` produces one
  self-contained `dist/index.html` (all code and data inlined) that runs from
  anywhere, including `file://`. A service worker cannot be inlined into a
  page, so `manifest.webmanifest`, `icon.svg` and `sw.js` sit next to it in
  `dist/`. They're only needed for add-to-home-screen and offline use when the
  game is served over http(s); the page works without them.
- **Copper colours live above index 31.** The framebuffer is 8-bit. Indices
  0–31 are the 32-colour palette; 32–255 are the "copper" sky/ground gradient,
  recomputed every frame. That is how the copper gets smooth bands without
  using palette colours, as the spec asks.
- **Palette fades are quantised to 12 bits** each frame, so G greyout, redout
  and the debrief fade step visibly, as on real hardware.
- **Screen-edge clipping** is done per scanline inside the polygon filler
  (spans are clamped to the clip rectangle) rather than by a second
  Sutherland–Hodgman pass in 2D. The result is identical for convex polygons
  and it's cheaper. Near-plane clipping is a real Sutherland–Hodgman pass in
  camera space, and it's unit tested.

## Controls

- **Debug key.** The spec gives `D` for the debug overlay and also WASD for
  the stick. `D` is roll-right, so the debug overlay is on `` ` `` (backtick)
  or **Shift+D**. The three-finger tap works on touch.
- Other keys the spec didn't assign: `Z`/`X` rudder, `E` emergency boost
  ("through the gate"), `I` start-up (or primer/mags/starter from the
  buttons), `J` bail out, `M` map, `C` canopy, `K` collapse the panel,
  `,` wheel brakes, `N` toggle mouse-as-stick, `Esc` pause, `H` help.
  Holding `G` works the Spitfire's hand pump.

## Renderer

- **Models are built from data by a kit.** Each aircraft in
  `content/models/` is a data description (fuselage cross-sections, wing
  planform, tail, markings) that `kit.ts` turns into vertex/face lists at
  load time, in three detail levels. Writing 100-face meshes out by hand as
  raw numbers would be unreviewable; the generated data is still plain
  vertex lists and convex faces, and the model viewer shows face counts.
- **Decals** (roundels, crosses, fin flashes) are faces tagged with a parent
  face. They're drawn immediately after the parent, so the painter's sort
  never puts a roundel behind its wing.
- **Half-Lambert shading** (0.5 + 0.5·n·sun) picks the ramp step, so faces
  in shadow stay readable at 32 colours instead of going black.
- **Perf check (milestone 2).** In headless Chromium with 6× CPU
  throttling as a stand-in for a mid-range phone, 40 aircraft in view held
  60 fps (about 1.6 ms of render time unthrottled). This still needs
  confirming on a real phone.

## Flight model

- **The stick commands load factor, not elevator angle.** Neutral stick holds
  about 1 g, as a trimmed aeroplane would. Pulling asks for more G, up to the
  aircraft's limit. The elevator then drives angle of attack towards
  whatever that G needs, capped a little past the stall. So full back stick
  at low speed stalls, and at high speed it pulls the G limit. Turn
  performance comes out of lift and G limits, and a hard turn bleeds energy
  through induced drag. This feels predictable on a touch stick and is the
  same for the AI.
- **Rotation is a command model** (target rates with first-order lags)
  rather than integrated moments of inertia. It's stable at 50 Hz and easy
  to tune per type.
- **Relative performance** is checked by tests (`tests/flight.test.ts`)
  rather than by matching historical figures:
  - The Spitfire out-turns the 109 at every height.
  - The Hurricane turns tightest below about 10,000 ft.
  - The 109 has the best climb and dive.
  - The Spitfire is fastest at altitude.
  - The Hurricane is slowest.
- **Big liberty: the 109's dive.** In the model the 109's dive advantage
  comes partly from a later high-speed drag rise (`dragRiseV`/`dragRiseK`).
  Historically it owed more to fuel injection, which let pilots bunt
  straight into a dive. That is also modelled, through the Merlin's
  negative-G cut-out.
- **Engine heat** is a simple first-order model. Full power on the ground
  heats slowly, emergency boost is fine within its time limit and overheats
  well beyond it, and a glycol leak (from M4) cuts cooling until the engine
  seizes.
- **G tolerance** starts greying at 4.3 g. Sustained 6.5 g blacks out in a
  few seconds, and 7.5 g in about 3. A blacked-out pilot's stick goes
  neutral, which also holds for AI pilots.

## Dogfight

- **Bullets are grouped.** Each simulated rifle-calibre bullet stands for 2
  real rounds (`TUNING.guns.roundsPerBullet`) with double damage; 20 mm
  shells are simulated one by one. That keeps eight Brownings plus a sky
  full of gunners cheap enough for a phone without changing the hit
  statistics much.
- **Harmonisation is static.** Guns converge on the sight line at the chosen
  range for the muzzle velocity alone, as they were harmonised on the
  ground. In flight the aircraft's own speed makes rounds strike slightly
  high, which is real. Hits ahead of convergence scatter visibly, as the
  spec asks; there's a test for it.
- **Damage overflow.** A part already shot away (elevator, rudder,
  aileron, radiator) passes further hits to the structure behind it.
  Without this, a tail control surface shielded the fuselage from a dead
  astern attack forever.
- **Fire** is a countdown: about 25–40 s from first flames to the tank going
  up, depending on how far it has spread. A fast dive may blow it out. The
  BAIL OUT button shows the seconds left.
- **AI spotting** uses range against the target's span, a blind spot behind
  and below, sun glare (a target within ~14° of the sun is roughly 12× harder
  to see), cloud line of sight and skill. The same rules apply to every AI
  pilot.
- **109 tactics.** Disciplined 109 pilots (average/experte) keep their energy:
  they extend and zoom rather than turn. With a Merlin-engined fighter on
  their tail they often bunt into a dive, which the pursuer can't follow
  without cutting out.

## The world

- **Generated geography.** `scripts/build-world.mjs` (`npm run world`) reads
  Natural Earth 10m land, minor islands and rivers, and SRTM 1-arc-second
  elevation (AWS "skadi" tiles), and caches the downloads in `.cache/`. It
  writes `src/content/world/terrainData.ts` (~110 KB, committed), so the
  build never needs the network. The output is:
  - a 500 m surface-class grid (sea, fields, wood, downs, marsh, town, city,
    river, mud, beach, orchard, hops, France, airfield, cliff, suburb),
    run-length encoded;
  - a 1 km height grid in 2 m units.
- **The hand-authored layer** is `src/content/world/places.json`: airfields,
  towns, landmarks, balloon barrages, extra rivers (the Medway, Swale,
  Stour and others aren't in Natural Earth) and region shapes (Weald
  woods, Downs, marshes, orchards, hops, mudflats, cliffs). The generator
  rasterises these into the class grid, so per-tile surface types live in
  the map data.
- **Fields are generated, but consistently.** Each farmland cell is split
  into one to four rectangular fields with hedges, hashed from its
  coordinates. The renderer draws exactly the fields that `fieldAt()` and
  `clearRun()` report to the landing model. Crops change with the date:
  green corn, then gold, stubble, and ploughed land.
- **Thames width** is stepped by longitude (1 cell in London, widening to
  the estuary) because Natural Earth gives only a centreline there.
- **Battersea has two chimneys.** The second pair was only built in 1955.
- **Cliffs** are drawn as chalk-white coastal cells rather than vertical
  faces. At 500 m resolution they read as the white line along the coast,
  which is how they look from the air.
- **Off the map** nothing is drawn, so the copper haze shows through.

## Up and down

- **The touchdown model** (`landing.ts`) scores each factor at contact:
  sink, bank, drift, speed over the stall, and nose-down attitude. Each
  is scaled so 1.0 is the edge of acceptable; the worst factor drives the
  outcome, through thresholds in `TUNING.landing`. The surface table and
  gear state (down, one leg, up) pick the row. The `luck` input only
  matters within ±0.12 of a threshold. Fatal outcomes need a genuinely bad
  impact: sink over 9 m/s, steep nose-down at speed, a large bank at
  speed, a big fire, or hitting obstacles fast. A test throws 5,000 random
  clean approaches at every landable surface and gear state, and none is
  fatal.
- **Bounces are physical.** A bounce puts the aircraft back in the air with
  a rebound speed. Each further contact counts for more (+15% per bounce).
- **The roll-out is simulated, not predicted.** Hedges, trees, buildings,
  water and craters are checked as the aircraft actually rolls through
  them, using the same hedged fields the renderer draws. A float in the
  flare can carry you over a hedge and into the next field, as it should.
- **Taildragger yaw.** On the ground a yaw rate feeds itself above walking
  pace (the CG is behind the main wheels), so torque swing grows into a
  ground loop unless rudder catches it. Auto-rudder catches it, less
  perfectly at full throttle (about 10° of swing on a full-power run). It
  can't pivot a stationary aircraft.
- **Spitfire hand pump.** Select gear up, then hold GEAR to pump (18
  strokes, about 7 s). The stick hand moves, so the aircraft wobbles in
  pitch and roll while you pump. Other types' gear is hydraulic.
- **Manual rudder adds to auto-rudder in the air**, so you can side-slip
  off height with a fire on, even with auto-rudder on.
- **Best glide speeds** in `content/aircraft.ts` are computed from the same
  drag polar the flight model uses, with the prop windmilling (Spitfire
  about 1:12 at ~120 mph). A test checks a simulated dead-stick glide
  against `glide.ts` to within 15%.
- **Oil on the windscreen** stipples out the centre of the windscreen and
  leaves the side panels clear, so a curved approach looking out of the
  side works.

## The sortie

- **Raids are abstract until met.** A raid is a plot moving along its route
  until any RAF fighter comes within 30 km, then it becomes real aircraft
  in formation. This keeps big days cheap. A raid nobody meets bombs
  abstractly (about half its bombs on target).
- **The controller works from the plot, not the truth.** Positions carry a
  few kilometres of error, and each raid's height has a fixed radar error of
  up to about ±1,800 m (±6,000 ft) plus noise. Strength is an estimate
  (×0.7–1.4). Vectors are collision-course intercepts from the plot.
- **Every discrete action is a recorded command** in the control stream:
  gear, flaps, bail-out, primer, mags, starter, tally-ho and orders. Same
  seed plus same frames gives the same sortie, which the replay camera needs.
- **Start-up**: primer, magnetos, starter; or one START in Assist. Cranking
  without priming or with the mags off coughs but won't catch.
- **Tally-ho needs something within 9 km.** When the player isn't leading,
  the AI leader calls it when he spots the enemy.
- **Claims**: the pilot claims from what they last saw. A target seen going
  down is claimed destroyed; a heavily hit target seen smoking is claimed
  destroyed 60% of the time. Intelligence confirms a claim only on evidence:
  a wreck in England, seen to crash, or a parachute. Otherwise it is allowed
  as a probable. Over-claiming therefore happens, as it did.
- **Rescue at sea** depends on distance from the English coast: about 85%
  within 5 km, falling to about 12% far out. Coming down in France means
  captivity.
- **Bomber gunners** were made much less accurate after the first
  playtests, where a box of Do 17s shot down a whole section before it
  closed. Aim error grows quickly with range, as flexible guns from a
  moving bomber did.
- **Quick Combat** starts you at height, 10 km off a raid of your choosing.

## The raid

- **Escort roles.** Close escort sticks to the bombers and turns on
  anything that attacks them; top cover sits 2,000 m higher and up-sun and
  dives on fighters below. Free-hunting sweeps go where they like.
- **The 110 circle** is shared state: the first 110 to see an RAF fighter
  within 4 km fixes a centre, and every 110 in the group flies round it,
  each covering the tail of the one ahead. It breaks up 40 seconds after
  the last threat. This is what they did, and it makes them stubborn but
  easy to get away from.
- **Vic or pairs.** In a tight vic a wingman's spotting is cut to 45%,
  because he is flying formation on his leader. Pairs (line abreast,
  wide) spot at full strength. The campaign makes the switch available
  part way through; Quick Combat uses whatever the date suggests.
- **15 September** in Quick Combat is the set piece: 33 bombers, 28 escorts
  and your squadron of 12 in one place, plus the second raid on its way.
  118 aircraft in all.
- **Performance.** That raid ran at 17 fps under a 6× CPU throttle in
  Chrome (a rough stand-in for a mid-range phone). Three things fixed most
  of it: building for ES2022 (class fields were being transpiled to
  `defineProperty` calls, which made every `new Vec3` slow), scratch vectors
  in the flight model instead of allocating about ten vectors per aircraft
  per tick, and caching each aircraft's flight environment and
  damage-to-handling result (recomputed on a hit, or once a second as
  glycol and engines wear). Now about 0.8 ms per tick for the sim and
  1.8 ms per frame for the render on a desktop: 34 fps at 6×, 48 fps at 4×.
  On the phone itself the 1990 mode cap is the fallback.

## Campaign

- **Only the big days are flown**: 31 days from 10 July to 29 October, with
  1-3 sorties each (two on 15 September). At 5-10 minutes a sortie the
  whole campaign is a few hours. The days in between pass off-screen: the
  squadron flies, claims, loses pilots, gets replacements and rests, and the
  sector stations are bombed and mended. The board says what happened.
- **The roster** is 17 invented pilots plus you, with a CO and two flight
  commanders. Replacements are mostly green, straight from an OTU, and from
  August more of them are Polish, Czech or from the Dominions. Pilots get
  better with sorties (average after 8; experte after 25 and 3 victories).
- **Fatigue** builds 0.13 a sortie and recovers 0.22 a night. Above 0.8 a
  pilot is stood down. In the air it means a little less G tolerance and
  slower spotting, for you as well.
- **Rank.** Pilot Officer flies as a wingman in the CO's squadron. Flight
  Lieutenant leads B Flight (six aircraft). Squadron Leader leads the
  squadron (twelve). Promotion comes on merit (sorties and confirmed
  victories) or by vacancy, when the man above is lost and you have enough
  sorties. A promotion on merit posts the incumbent away, so nobody has to
  die for it.
- **Vic or pairs.** The board offers pairs from Adlertag (13 August). The
  choice is yours whatever your rank: as a junior you are the one who has
  talked the CO round. Vics spot worse in the air (see the raid) and lose
  about a third more pilots off-screen.
- **Airfields.** Each sector station has a damage level; 40 bombs close
  one, and it mends by a quarter a day. Damage puts flagged craters on the
  grass (placed from a seed, so they stay put across a day). A raid on your
  own field is a scramble under attack.
- **Score** (out of 1000): sector stations open 300, raids turned back
  250, the squadron's survival 250, your record 150, rank 50. Victories
  alone can't win it.
- **Dying.** In Ironman a lost pilot ends the career, and leaving a sortie
  part way counts as turning back with a rough engine (no walking away
  from a fight going badly). Otherwise the sortie is struck from the record
  and flown again with a fresh seed.
- **Saves** are a single versioned JSON blob in localStorage, written after
  every sortie and every change on the board. A save from another version
  is refused with a clear message, and the player can start again.
- **The docks plume** burns from 7 September: a column of smoke kilometres
  high above the Surrey and West India Docks, leaning downwind, visible
  from most of Kent. It is tallest in the first days.

## Juice

- **Sound** is built at startup from oscillators and seeded noise (about
  20 ms), crushed to 8 bits at 11 kHz, and played through four channels
  with Amiga-style panning and a 4.4 kHz low-pass for the LED filter. In
  flight: engine, guns, one-shots, and wind or buffet. One-shots steal a
  channel by priority, so an explosion can briefly drown the wind, as on
  the real chip. The Merlin is a smooth, deep twelve; the DB 601 is
  harder-edged and a different note.
- **Music** is a tiny tracker: four channels, patterns written as
  `note:length` lines, an order list, and synthesised instruments (pulse,
  square, triangle, "brass", "flute", kick, snare). Two original tunes: a
  march in D for the title and a quiet piece in D minor for the debrief.
  None in flight, nor in the dispersal hut, which has the telephone and
  the bell.
- **Audio starts on the first touch or key**, because mobile browsers
  insist. Until then everything is silent and nothing breaks.
- **Replay** re-runs the sortie from its seed and the recorded control
  frames (every discrete action is a command in the frame). A sortie
  snapshots the shared map state (craters, wrecked hangars, balloons) when
  it starts and can rewind it, so the replay starts from the same world.
  Watch from the chase, fly-by, combat (over the shoulder towards the
  nearest enemy) or cockpit cameras, follow any aircraft, and run at up to
  the time-compression limit.

## The other side (stretch)

- **A 109 escort to London**, from the title menu: you lead a Schwarm of
  four (in pairs, of course) as close escort for a dozen or more Dorniers
  or Heinkels, from Cap Gris Nez to the docks or Woolwich and back, on one
  of the big days of late August or September.
- **The fuel gauge is the enemy.** You start at the rendezvous with 80% of
  the 109's 400 litres. London and back at escort speed leaves about ten
  minutes in hand; a fight at full throttle eats it. The red lamp lights
  at 20%, roughly ten minutes at cruise, and blinks in the last few
  minutes. Run dry over the Channel and it's a ditching, and the
  Seenotdienst's chances depend on how close to France you are.
- **Fighter Command sends squadrons up** as the raid comes in: Hurricanes
  low for the bombers, Spitfires high for the escort (as Park wanted), more
  over the target, and a few Spitfires chasing the raid home. Their
  leaders are steered onto the raid every five seconds, as radar and the
  controllers did.
- **Home** is back over France with no RAF fighter within 8 km for 20
  seconds: we skip the circuit at Marquise. Coming down in England means
  captivity.
- **Claims** follow the Luftwaffe rule: a witness, or a wreck on our side of
  the Channel. Over England there is no wreck to inspect.
- **R/T** is in English with the handful of words every 109 pilot used:
  Indianer (enemy fighters), Pauke pauke (attacking), Horrido (a victory).
  Callsigns and names are invented.
- The sortie shares the world, raid, AI, debrief and replay with the RAF
  sortie; the screen talks to either through one small interface.

## Finding the enemy

- Playtesting said it was very hard to find the enemy, so the markers now
  work at every range and in Authentic mode too (Settings: ENEMY MARKERS).
- **Reported raids** (radar plots not yet in sight) are a yellow oblong with
  the radar's estimate, "RAID 30+ AIRCRAFT / OFF HYTHE 18 MI", drawn at the
  radar's height, which may be thousands of feet out, as it was.
- **Formations in sight** within 45 km are a white oblong round the whole
  group, "11 BOMBERS + 8 FIGHTERS / OFF DUNGENESS 7.5 MI".
- **Inside 4.5 km** the oblong breaks into brackets on each aircraft. The
  nearest six get their type, and experten get "ACE!" in yellow. Labels
  that would overlap are moved or dropped.
- **Off screen**, an arrow on the edge of the view points to the nearest
  group, with its strength and distance.
- The lead pipper stays an Assist feature.

## Playtest fixes (handling, sea, readouts)

- **Negative G.** Forward stick used to reach negative G a third of the way
  forward, and the Merlin cut out the instant G went below -0.15, so any
  push into a dive starved it. Now the first 70% of forward travel unloads
  smoothly to zero G and only the last 30% goes negative. The engine needs a
  quarter of a second below -0.2 G before it cuts. A hard bunt still does
  it, as it should. Easing into a dive doesn't.
- **Stalls.** Pulling was linear, so half stick asked for 4 G and slow
  pulls went straight past the stall. The pull is now progressive
  (G rises with stick^1.5), and short of the last 12% of travel the wing is
  held just below the stall angle: it buffets and mushes rather than
  breaking. Full back stick still stalls it, and spins are still there.
- **The Stuka's dive.** Its dive brakes were only a closed throttle, so it
  dived at up to 460 mph and nothing could catch it. Dive brakes are now
  drag, holding it at about 310 mph, near the real figure.
- **The sea** went to haze grey in the first fog band because its colour
  ramp had only three steps. It now stays sea-blue until the last band,
  like the land.
- **Big readouts.** The dials are faithful but unreadable on a phone.
  Airspeed (red with SLOW! near the stall) and height are drawn large in
  the lower corners of the view, with the climb or sink rate. They can be
  switched off in Settings.
