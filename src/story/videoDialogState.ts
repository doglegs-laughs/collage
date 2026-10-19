import type { VideoSettings } from './model';

type Transition = VideoSettings['transition'];

/**
 * What the video dialog remembers while it is open (not saved with the story):
 * `restore` is the transition in effect before beat sync was switched on, `choice` the transition the user picked while it was on.
 */
export type SyncMemory = { restore: Transition | null; choice: Transition | null };
export const NO_MEMORY: SyncMemory = { restore: null, choice: null };

export type SyncStep = { patch: Partial<VideoSettings>; memory: SyncMemory };

/** Beat sync on: photos change on the beat, so pages cut by default (a crossfade can still be picked afterwards). Off: back to the transition from before. */
export function setBeatSync(video: Pick<VideoSettings, 'transition' | 'syncToBeats'>, memory: SyncMemory, enabled: boolean): SyncStep {
  if (enabled) {
    if (video.syncToBeats) return { patch: {}, memory };
    return {
      patch: { syncToBeats: true, fitToMusic: false, transition: memory.choice ?? 'none' },
      memory: { restore: video.transition, choice: memory.choice },
    };
  }
  if (!video.syncToBeats) return { patch: {}, memory };
  return {
    patch: { syncToBeats: false, ...(memory.restore ? { transition: memory.restore } : {}) },
    memory: { restore: null, choice: memory.choice },
  };
}

/** The user picks a transition. While beat sync is on the pick is remembered for the next time it is switched on in this dialog. */
export function pickTransition(video: Pick<VideoSettings, 'syncToBeats'>, memory: SyncMemory, transition: Transition): SyncStep {
  return { patch: { transition }, memory: video.syncToBeats ? { ...memory, choice: transition } : memory };
}
