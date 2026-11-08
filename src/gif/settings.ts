import type { GifLoop, PlanOptions } from './plan';
import type { GifFit, GifShape } from './shape';

export type GifSettings = {
  secondsPerFrame: number;
  holdEnds: boolean;
  loop: GifLoop;
  boomerang: boolean;
  crossfade: boolean;
  shape: GifShape;
  fit: GifFit;
  background: string;
  width: number;
};

export const DEFAULT_SETTINGS: GifSettings = {
  secondsPerFrame: 0.5,
  holdEnds: false,
  loop: 'forever',
  boomerang: false,
  crossfade: false,
  shape: 'original',
  fit: 'fill',
  background: '#ffffff',
  width: 720,
};

export const planOptions = (s: GifSettings): PlanOptions => ({
  secondsPerFrame: s.secondsPerFrame,
  holdEnds: s.holdEnds,
  loop: s.loop,
  boomerang: s.boomerang,
  crossfade: s.crossfade,
});
