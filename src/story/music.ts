import { useEffect, useState } from 'react';
import { api, type BuiltinTrack, type MusicMood } from '../api';
import type { Story, VideoSettings } from './model';
import { patchVideo } from './timeline';

export const MOOD_LABELS: Record<MusicMood, string> = { upbeat: 'Upbeat', happy: 'Happy', nostalgic: 'Nostalgic' };
export const MOODS = Object.keys(MOOD_LABELS) as MusicMood[];

/** What the music picker hands back: a music file, a built-in track (`builtin` is its id), or null for no music. */
export type MusicChoice = { path: string; builtin?: string } | null;

/** The video settings that make `choice` the story's music (clearing is the callers' job, as it also resets beat sync). */
export const musicPatch = (choice: NonNullable<MusicChoice>): Partial<VideoSettings> => ({ audioPath: choice.path, ...(choice.builtin ? { audioBuiltin: choice.builtin } : {}) });

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** m:ss for a track length. */
export const formatDuration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * Built-in tracks are saved by id and found again on load, because their files live inside the app, whose folder
 * changes when it moves or updates. An id that is not in the manifest (the track was dropped from the pack) clears the
 * music, so a story never keeps a path that points into an old copy of the app. `missing` is that id, for a message.
 */
export function resolveBuiltinMusic(story: Story, tracks: BuiltinTrack[]): { story: Story; missing?: string } {
  const id = story.video.audioBuiltin;
  if (!id) return { story };
  const track = tracks.find((t) => t.id === id);
  if (track) return { story: story.video.audioPath === track.path ? story : { ...story, video: { ...story.video, audioPath: track.path } } };
  return { story: patchVideo(story, { audioPath: null, fitToMusic: false, syncToBeats: false }), missing: id };
}

/** What to show for the story's music: a built-in track's title, else the file name; null with no music. */
export function musicLabel(video: Pick<VideoSettings, 'audioPath' | 'audioBuiltin'>, tracks: BuiltinTrack[]): string | null {
  if (!video.audioPath) return null;
  return tracks.find((t) => t.id === video.audioBuiltin)?.title ?? baseName(video.audioPath);
}

export const tracksByMood = (tracks: BuiltinTrack[]) =>
  MOODS.map((mood) => ({ mood, label: MOOD_LABELS[mood], tracks: tracks.filter((t) => t.mood === mood) })).filter((g) => g.tracks.length);

let cache: Promise<BuiltinTrack[]> | null = null;
/** The starter pack, read once per session (an empty list when it cannot be read). */
export function loadBuiltinTracks(): Promise<BuiltinTrack[]> {
  cache ??= api.builtinMusic().catch(() => []);
  return cache;
}

export function useBuiltinTracks(): BuiltinTrack[] {
  const [tracks, setTracks] = useState<BuiltinTrack[]>([]);
  useEffect(() => {
    let active = true;
    void loadBuiltinTracks().then((t) => { if (active) setTracks(t); });
    return () => { active = false; };
  }, []);
  return tracks;
}

// --- Recently chosen music files (built-in tracks are always listed, so they are not remembered here) ---

export const MAX_RECENT_MUSIC = 8;
const RECENT_KEY = 'collage-recent-music';

/** `path` moved to the front (added if new), no duplicates, at most `max` entries. */
export function addRecentMusic(list: string[], path: string, max = MAX_RECENT_MUSIC): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}

export const removeRecentMusic = (list: string[], path: string): string[] => list.filter((p) => p !== path);

/** Parse the stored list; anything that is not an array of non-empty strings is ignored. */
export function parseRecentMusic(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((p): p is string => typeof p === 'string' && p !== '' && !p.includes('\0')))].slice(0, MAX_RECENT_MUSIC);
  } catch { return []; }
}

export function readRecentMusic(): string[] {
  try { return parseRecentMusic(localStorage.getItem(RECENT_KEY)); } catch { return []; }
}

function saveRecentMusic(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable: the list just is not kept */ }
}

export function rememberMusic(path: string): void {
  saveRecentMusic(addRecentMusic(readRecentMusic(), path));
}

export function forgetMusic(path: string): void {
  saveRecentMusic(removeRecentMusic(readRecentMusic(), path));
}
