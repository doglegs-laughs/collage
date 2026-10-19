import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type BeatAnalysis } from '../../api';

export type MusicAnalysis = {
  status: 'none' | 'idle' | 'busy' | 'done' | 'error';
  result?: BeatAnalysis;
  error?: string;
  analyze: () => void;
};

/** Finished analyses by file path, so reopening the timeline does not decode the music again (the main process caches too). */
const known = new Map<string, BeatAnalysis>();

const readable = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not analyze this music.');

/** Beat analysis of the story's music (a track with no clear beats resolves with `noBeats: true`, its waveform and duration): runs when `analyze()` is called, or on its own when `auto` is set. */
export function useMusicAnalysis(path: string | null, auto: boolean): MusicAnalysis {
  const [state, setState] = useState<{ path: string; busy?: boolean; result?: BeatAnalysis; error?: string } | null>(null);
  const run = useRef(0);

  const analyze = useCallback(() => {
    if (!path) return;
    const id = ++run.current;
    setState({ path, busy: true });
    api.analyzeAudio(path, true).then( // soft: a track with no clear beats still gives its waveform and length
      (result) => { known.set(path, result); if (run.current === id) setState({ path, result }); },
      (e: unknown) => { if (run.current === id) setState({ path, error: readable(e) }); },
    );
  }, [path]);

  const mine = state?.path === path ? state : null;
  const result = mine?.result ?? (path ? known.get(path) : undefined);
  const busy = !!mine?.busy;
  const error = mine?.error;
  useEffect(() => {
    if (auto && path && !result && !busy && !error) analyze();
  }, [auto, path, result, busy, error, analyze]);
  useEffect(() => () => { run.current++; }, []);

  const status = !path ? 'none' : result ? 'done' : busy ? 'busy' : error ? 'error' : 'idle';
  // A stable object between renders (playback ticks re-render the panel 60 times a second), so memoized rows keep their props.
  return useMemo(() => ({ status, result, error, analyze }), [status, result, error, analyze]);
}
