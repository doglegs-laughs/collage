import { useCallback, useEffect, useRef, useState } from 'react';
import { fileUrl } from '../exportStory';
import { loopSeekTarget, musicPosition } from './math';

export type Playback = {
  /** Playhead position in video seconds. */
  time: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
};

/**
 * Preview transport. The playhead runs on the wall clock; the music (an <audio> element on a file:// URL) is started at
 * `audioOffset + time` and re-synced whenever the playhead or the offset is moved. Music that cannot be played just leaves the playhead running.
 * The music repeats at `loopSeconds` (the export's loop point: the beat grid's loop with beat sync), or at the end of the file when null.
 */
export function usePlayback(total: number, audioPath: string | null, audioOffset: number, loopSeconds: number | null): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const clock = useRef({ wall: 0, base: 0 });
  const timeRef = useRef(0);
  const totalRef = useRef(total);
  totalRef.current = total;
  const offsetRef = useRef(audioOffset);
  offsetRef.current = audioOffset;
  const loopRef = useRef(loopSeconds);
  loopRef.current = loopSeconds;
  const audio = useRef<{ path: string; el: HTMLAudioElement } | null>(null);

  const setBoth = (t: number) => { timeRef.current = t; setTime(t); };

  const dropAudio = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    a.el.pause();
    a.el.removeAttribute('src');
    a.el.load();
    audio.current = null;
  }, []);

  /** The loop point in the file: the requested one (never past the end of the file), else the end of the file once it is known. */
  const loopOf = (a: HTMLAudioElement): number | null => {
    const fileEnd = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null;
    return loopRef.current && fileEnd ? Math.min(loopRef.current, fileEnd) : loopRef.current ?? fileEnd;
  };

  const audioAt = useCallback((t: number) => {
    const a = audio.current?.el;
    if (!a) return;
    const loop = loopOf(a);
    try { a.currentTime = musicPosition(offsetRef.current, t, loop); } catch { /* not seekable yet */ }
  }, []);

  /** Wrap the sound back at the loop point, as the export does (the element's own `loop` only wraps at the end of the file). */
  const loopAudio = useCallback(() => {
    const a = audio.current?.el;
    if (!a || (a.paused && !a.ended)) return;
    const loop = loopOf(a);
    const to = loopSeekTarget(a.currentTime, loop, a.ended);
    if (to === null) return;
    try { a.currentTime = to; } catch { /* not seekable yet */ }
    if (a.ended || a.paused) a.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    audio.current?.el.pause();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (!(totalRef.current > 0)) return;
    if (timeRef.current >= totalRef.current - 1e-3) setBoth(0);
    clock.current = { wall: performance.now(), base: timeRef.current };
    setPlaying(true);
    if (!audioPath) return;
    if (audio.current?.path !== audioPath) {
      dropAudio();
      const el = new Audio(fileUrl(audioPath));
      el.preload = 'auto';
      audio.current = { path: audioPath, el };
    }
    const { el } = audio.current!;
    audioAt(timeRef.current);
    // The wall clock restarts when the sound actually begins, so a slow start does not leave the music behind the pictures.
    const onPlaying = () => { clock.current = { wall: performance.now(), base: timeRef.current }; };
    el.addEventListener('playing', onPlaying, { once: true });
    el.play().catch(() => el.removeEventListener('playing', onPlaying));
  }, [audioPath, audioAt, dropAudio]);

  const seek = useCallback((t: number) => {
    const v = Math.max(0, Math.min(totalRef.current, t));
    setBoth(v);
    clock.current = { wall: performance.now(), base: v };
    audioAt(v);
  }, [audioAt]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const t = clock.current.base + (performance.now() - clock.current.wall) / 1000;
      if (t >= totalRef.current) {
        setBoth(totalRef.current);
        pause();
        return;
      }
      setBoth(t);
      loopAudio();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause, loopAudio]);

  // The music start moved (a drag, a typed value, undo) while playing: the sound jumps to where the playhead now belongs.
  useEffect(() => { if (playingRef.current) audioAt(timeRef.current); }, [audioOffset, loopSeconds, audioAt]);
  // A different song, or none: stop the old one.
  useEffect(() => {
    if (audio.current && audio.current.path !== audioPath) { dropAudio(); setPlaying(false); }
  }, [audioPath, dropAudio]);
  useEffect(() => dropAudio, [dropAudio]);
  // Keep the playhead inside a video that got shorter while it was parked past the end.
  useEffect(() => { if (timeRef.current > total) setBoth(total); }, [total]);

  return { time, playing, play, pause, toggle, seek };
}
