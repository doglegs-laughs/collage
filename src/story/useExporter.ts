import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BeatAnalysis } from '../api';
import { useToast } from '../ui/Toast';
import { audioDuration, exportImages, exportVideo, isAbort } from './exportStory';
import { visibleIndices, type Story } from './model';

export type ExportJob = { kind: 'images' | 'video'; label: string; fraction: number | null; /** Date.now() when the export began, for the elapsed-time readout. */ startedAt: number };
export type ExportDone = { message: string; reveal: string };
export type VideoRequest = { width: number; pageSeconds: number; fitToMusic: boolean; beatSync?: { analysis: BeatAnalysis; beatsPerPage: number; audioPath: string } };

/** Runs image/video exports with progress, cancel and a result message. */
export function useExporter(getStory: () => Story) {
  const toast = useToast();
  const [job, setJob] = useState<ExportJob | null>(null);
  const [done, setDone] = useState<ExportDone | null>(null);
  const abort = useRef<AbortController | null>(null);
  const encoding = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const fail = useCallback((e: unknown) => {
    if (isAbort(e)) return;
    toast(e instanceof Error ? e.message : 'The export did not finish.', 'error');
  }, [toast]);

  const finish = useCallback(() => {
    abort.current = null;
    encoding.current = false;
    if (mounted.current) setJob(null);
  }, []);

  const images = useCallback(async (width: number) => {
    if (abort.current) return;
    if (!visibleIndices(getStory()).length) { toast('Every page is hidden, so there is nothing to export.', 'error'); return; }
    setDone(null);
    try {
      const folder = await api.chooseFolder();
      if (!folder) return;
      const ctl = new AbortController();
      abort.current = ctl;
      const story = getStory();
      const startedAt = Date.now();
      setJob({ kind: 'images', label: 'Exporting images', fraction: 0, startedAt });
      const r = await exportImages(story, {
        folder, width, signal: ctl.signal,
        onProgress: (d, t) => setJob({ kind: 'images', label: `Exporting ${Math.min(d + 1, t)} of ${t}`, fraction: d / t, startedAt }),
      });
      const message = `Saved ${r.files.length} image${r.files.length === 1 ? '' : 's'} to ${folder.split(/[\\/]/).pop()}`;
      // The status bar shows the message with a Reveal link; a toast on top of it would cover the link.
      setDone({ message, reveal: r.files[0] ?? folder });
    } catch (e) {
      fail(e);
    } finally {
      finish();
    }
  }, [getStory, toast, fail, finish]);

  const video = useCallback(async (req: VideoRequest) => {
    if (abort.current) return;
    if (!visibleIndices(getStory()).length) { toast('Every page is hidden, so there is nothing to export.', 'error'); return; }
    setDone(null);
    const ctl = new AbortController();
    abort.current = ctl;
    const story = getStory();
    let off = () => {};
    try {
      const startedAt = Date.now();
      setJob({ kind: 'video', label: 'Preparing', fraction: null, startedAt });
      let music: number | null = null;
      if (req.beatSync && req.beatSync.audioPath !== story.video.audioPath) throw new Error('The music changed. Open video export and analyze it again.');
      if (!req.beatSync && req.fitToMusic && story.video.audioPath && !story.video.timeline) {
        music = await audioDuration(story.video.audioPath);
        if (music === null) toast('Could not read the music length, so pages keep their own durations.', 'info');
      }
      off = api.onVideoProgress((f) => {
        if (encoding.current) setJob({ kind: 'video', label: `Encoding ${Math.round(f * 100)}%`, fraction: f, startedAt });
      });
      const total = visibleIndices(story).length;
      const { path } = await exportVideo(story, {
        width: req.width, pageSeconds: req.pageSeconds, fitToMusicSeconds: music, beatSync: req.beatSync, signal: ctl.signal,
        onCached: () => setJob({ kind: 'video', label: 'Using the video you already made', fraction: null, startedAt }),
        onProgress: (d, t) => {
          if (d >= t) { encoding.current = true; setJob({ kind: 'video', label: 'Encoding 0%', fraction: 0, startedAt }); }
          else setJob({ kind: 'video', label: `Rendering pages ${d + 1} / ${total}`, fraction: d / t, startedAt });
        },
      });
      if (!path) return;
      const message = `Video saved: ${path.split(/[\\/]/).pop()}`;
      setDone({ message, reveal: path });
    } catch (e) {
      fail(e);
    } finally {
      off();
      finish();
    }
  }, [getStory, toast, fail, finish]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    if (encoding.current) void api.cancelVideo().catch(() => {});
  }, []);

  return { job, done, clearDone: () => setDone(null), images, video, cancel };
}
export type Exporter = ReturnType<typeof useExporter>;
