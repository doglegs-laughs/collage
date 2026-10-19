import { useCallback, useEffect, useRef, useState } from 'react';
import { fileUrl } from '../exportStory';

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
 * `audioOffset + time` and re-synced whenever the playhead is moved. Music that cannot be played just leaves the playhead running.
 */
export function usePlayback(total: number, audioPath: string | null, audioOffset: number): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef({ wall: 0, base: 0 });
  const timeRef = useRef(0);
  const totalRef = useRef(total);
  totalRef.current = total;
  const offsetRef = useRef(audioOffset);
  offsetRef.current = audioOffset;
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

  const audioAt = useCallback((t: number) => {
    const a = audio.current?.el;
    if (!a) return;
    const at = offsetRef.current + t;
    try { a.currentTime = Number.isFinite(a.duration) && a.duration > 0 ? at % a.duration : at; } catch { /* not seekable yet */ }
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
      el.loop = true;
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
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause]);

  // A different song, or none: stop the old one.
  useEffect(() => {
    if (audio.current && audio.current.path !== audioPath) { dropAudio(); setPlaying(false); }
  }, [audioPath, dropAudio]);
  useEffect(() => dropAudio, [dropAudio]);
  // Keep the playhead inside a video that got shorter while it was parked past the end.
  useEffect(() => { if (timeRef.current > total) setBoth(total); }, [total]);

  return { time, playing, play, pause, toggle, seek };
}
