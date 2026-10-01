// Model registry: aircraft type → 3D model (render side only).

import type { AircraftId } from '../aircraft';
import type { Model } from '../../render/model';
import { spitfireModel } from './spitfire';

const registry: Partial<Record<AircraftId, Model>> = {
  spitfire: spitfireModel,
};

export function registerModel(id: AircraftId, m: Model): void {
  registry[id] = m;
}

export function modelFor(id: AircraftId): Model {
  return registry[id] ?? spitfireModel;
}

export function allModels(): Model[] {
  return Object.values(registry) as Model[];
}
