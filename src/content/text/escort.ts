// The other side: a Bf 109 escort over England. Radio calls are given in
// English, with the few words every 109 pilot used. Invented callsigns.

export const LW_RT = {
  rendezvous: (target: string) => `Rendezvous with the bombers over Cap Gris Nez. Close escort to ${target}. Stay with them.`,
  coast: 'English coast below. Keep your eyes open.',
  indianer: (what: string, clock: string, above: string) => `Indianer! ${what}, ${clock}, ${above}!`,
  pauke: (who: string) => `${who}: Pauke, pauke! Going in!`,
  follow: (who: string) => `${who}: Stay with me.`,
  reform: (who: string) => `${who}: Back to the bombers. Close up.`,
  bombersCall: 'Bombers here: fighters attacking! Where is the escort?',
  bombsGone: 'Bombers: bombs gone. Turning for home.',
  horrido: (who: string) => `${who}: Horrido!`,
  hit: (who: string) => `${who} is hit! He's going down!`,
  baled: (who: string) => `${who} has baled out.`,
  redLight: 'The red light is on. Time to go home.',
  overFrance: 'French coast. Home.',
  noFuel: 'Engine quiet. Glide for the coast.',
};

export const LW_PLACES = {
  base: 'Marquise',
  fields: ['Marquise', 'Calais-Marck'],
};

export const LW_LOG = {
  escorted: (types: string, target: string) => `Close escort for ${types} to ${target}.`,
  noContact: (target: string) => `Close escort to ${target}. No contact with the enemy.`,
  claims: (n: number) => (n === 1 ? 'One victory claimed.' : n > 1 ? `${n} victories claimed.` : ''),
  homeRed: (field: string) => `Landed at ${field} with the red light on.`,
  home: (field: string) => `Back at ${field}.`,
  ditchedRescued: (pl: string) => `Ditched off ${pl}. Picked up by the Seenotdienst.`,
  ditchedLost: (pl: string) => `Ditched off ${pl}. Not picked up.`,
  bailSeaRescued: (pl: string) => `Baled out over the Channel off ${pl}. Picked up by a rescue seaplane.`,
  bailSeaLost: (pl: string) => `Baled out over the Channel off ${pl}. Not picked up.`,
  pow: (pl: string) => `Came down ${pl}. Taken prisoner.`,
  killed: (pl: string) => `Killed ${pl}.`,
  forcedFrance: (pl: string) => `Forced landing ${pl}, in France.`,
};
