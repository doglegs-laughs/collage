import { makeRng, type El, type Photo } from '../src/story/model';

export const SIZES: [number, number][] = [[4000, 3000], [3000, 4000], [4000, 4000], [6000, 2400], [3000, 2000], [2000, 3000]];
export function makePhotos(n: number, seed = 1, only?: [number, number][]): Photo[] {
  const rng = makeRng(seed);
  const sizes = only ?? SIZES;
  return Array.from({ length: n }, (_, i) => {
    const [width, height] = sizes[Math.floor(rng() * sizes.length)];
    return { id: `p${i}`, name: `p${i}.jpg`, width, height };
  });
}
export const photoIdsOf = (els: El[]) => els.flatMap((e) => (e.kind === 'photo' && e.photoId ? [e.photoId] : []));
