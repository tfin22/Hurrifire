// Model registry: aircraft type → 3D model (render side only).

import type { AircraftId } from '../aircraft';
import type { Model } from '../../render/model';
import { spitfireModel } from './spitfire';
import { bf109Model } from './bf109';
import { bf110Model, do17Model, he111Model, hurricaneModel, ju87Model, ju88Model } from './roster';

const registry: Record<AircraftId, Model> = {
  spitfire: spitfireModel,
  hurricane: hurricaneModel,
  bf109: bf109Model,
  bf110: bf110Model,
  do17: do17Model,
  he111: he111Model,
  ju88: ju88Model,
  ju87: ju87Model,
};

export function registerModel(id: AircraftId, m: Model): void {
  registry[id] = m;
}

export function modelFor(id: AircraftId): Model {
  return registry[id];
}

export function allModels(): Model[] {
  return Object.values(registry);
}
