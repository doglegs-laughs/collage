import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type BuiltinTrack } from '../api';
import { Button } from '../ui/Controls';
import { useDialogFocus } from '../ui/useDialogFocus';
import { useToast } from '../ui/Toast';
import { fileUrl } from './exportStory';
import type { VideoSettings } from './model';
import { forgetMusic, formatDuration, readRecentMusic, removeRecentMusic, rememberMusic, tracksByMood, useBuiltinTracks, type MusicChoice } from './music';

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** One preview at a time: starting another stops the first, and unmounting stops the sound. `key` says which row is playing. */
function useMusicPreview(onError: (message: string) => void) {
  const el = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const stop = useCallback(() => {
    el.current?.pause();
    el.current = null;
    setPlaying(null);
  }, []);
  useEffect(() => stop, [stop]);
  const toggle = useCallback((key: string, path: string) => {
    if (el.current && playing === key) { stop(); return; }
    stop();
    const audio = new Audio(fileUrl(path));
    const fail = () => { if (el.current === audio) { stop(); errorRef.current('Could not play that file.'); } };
    audio.addEventListener('ended', () => { if (el.current === audio) stop(); });
    audio.addEventListener('error', fail);
    el.current = audio;
    setPlaying(key);
    audio.play().catch(fail);
  }, [playing, stop]);
  return { playing, toggle };
}

function PreviewButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className="music-play" aria-label={`${on ? 'Stop preview of' : 'Preview'} ${label}`} aria-pressed={on} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {on ? '❚❚' : '▶︎'}
    </button>
  );
}

function TrackRow({ track, current, playing, onPreview, onUse }: { track: BuiltinTrack; current: boolean; playing: boolean; onPreview: () => void; onUse: () => void }) {
  return (
    <li className={`music-item${current ? ' current' : ''}`} aria-current={current || undefined} onClick={onUse} data-testid="music-builtin">
      <PreviewButton on={playing} label={track.title} onClick={onPreview} />
      <span className="music-info">
        <span className="music-title">{track.title}</span>
        <span className="music-meta">{track.artist} · {formatDuration(track.durationSec)} · {track.bpm} BPM</span>
      </span>
      <button type="button" className="link" onClick={(e) => { e.stopPropagation(); onUse(); }} aria-label={`Use ${track.title}`}>{current ? '✓ In use' : 'Use'}</button>
    </li>
  );
}

type Props = { video: Pick<VideoSettings, 'audioPath' | 'audioBuiltin'>; onChoose: (choice: MusicChoice) => void; onClose: () => void };

/** Modal for choosing the story's music: the built-in starter pack by mood, recently used files, or any file on the computer. */
export function MusicPicker({ video, onChoose, onClose }: Props) {
  const toast = useToast();
  const focus = useDialogFocus<HTMLDivElement>();
  const tracks = useBuiltinTracks();
  const preview = useMusicPreview((m) => toast(m, 'error'));
  const [recent, setRecent] = useState<string[]>([]);
  const [credits, setCredits] = useState(false);

  // Files that are gone are left out (and forgotten), so the list never offers music that cannot play.
  useEffect(() => {
    let active = true;
    const saved = readRecentMusic();
    void Promise.all(saved.map((p) => api.exists(p).catch(() => false))).then((found) => {
      if (!active) return;
      saved.forEach((p, i) => { if (!found[i]) forgetMusic(p); });
      setRecent(saved.filter((_, i) => found[i]));
    });
    return () => { active = false; };
  }, []);

  // Escape closes only the picker, not the dialog under it (this listener runs first and stops the event).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const choose = (choice: MusicChoice) => {
    if (choice && !choice.builtin) rememberMusic(choice.path);
    onChoose(choice);
    onClose();
  };
  const browse = async () => {
    try {
      const path = await api.openAudio();
      if (path) choose({ path });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not choose music.', 'error');
    }
  };

  return createPortal(
    <div className="story-modal-backdrop music-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="story-modal music-picker" role="dialog" aria-modal="true" aria-label="Choose music" tabIndex={-1} data-testid="music-picker"
        ref={focus.ref} onKeyDown={(e) => { focus.onKeyDown(e); e.stopPropagation(); }}
      >
        <div className="music-head">
          <h2 className="section-title">Choose music</h2>
          <button type="button" className="borders-x" onClick={onClose} aria-label="Close music picker">×</button>
        </div>
        <ul className="music-list">
          <li className={`music-item${video.audioPath ? '' : ' current'}`} onClick={() => choose(null)}>
            <span className="music-info"><span className="music-title">No music</span></span>
            <button type="button" className="link" onClick={(e) => { e.stopPropagation(); choose(null); }} data-testid="music-none">{video.audioPath ? 'Use' : '✓ In use'}</button>
          </li>
        </ul>

        {tracksByMood(tracks).map((group) => (
          <section key={group.mood} aria-label={group.label}>
            <h3 className="music-group">{group.label}</h3>
            <ul className="music-list">
              {group.tracks.map((t) => (
                <TrackRow
                  key={t.id} track={t} current={video.audioBuiltin === t.id && !!video.audioPath} playing={preview.playing === `b:${t.id}`}
                  onPreview={() => preview.toggle(`b:${t.id}`, t.path)} onUse={() => choose({ path: t.path, builtin: t.id })}
                />
              ))}
            </ul>
          </section>
        ))}
        {tracks.length > 0 && (
          <p className="hint">
            Built-in music is free to use anywhere. <button type="button" className="link" aria-expanded={credits} onClick={() => setCredits((c) => !c)}>Credits</button>
          </p>
        )}
        {credits && (
          <ul className="music-credits" data-testid="music-credits">
            {tracks.map((t) => <li key={t.id}>{t.title} by {t.artist} ({t.license})</li>)}
          </ul>
        )}

        {recent.length > 0 && (
          <section aria-label="Recent">
            <h3 className="music-group">Recent</h3>
            <ul className="music-list">
              {recent.map((p) => {
                const current = video.audioPath === p && !video.audioBuiltin;
                return (
                  <li key={p} className={`music-item${current ? ' current' : ''}`} aria-current={current || undefined} onClick={() => choose({ path: p })} data-testid="music-recent">
                    <PreviewButton on={preview.playing === `r:${p}`} label={baseName(p)} onClick={() => preview.toggle(`r:${p}`, p)} />
                    <span className="music-info"><span className="music-title" title={p}>{baseName(p)}</span></span>
                    <button type="button" className="link" onClick={(e) => { e.stopPropagation(); choose({ path: p }); }} aria-label={`Use ${baseName(p)}`}>{current ? '✓ In use' : 'Use'}</button>
                    <button type="button" className="music-remove" aria-label={`Remove ${baseName(p)} from recent`} onClick={(e) => { e.stopPropagation(); forgetMusic(p); setRecent((r) => removeRecentMusic(r, p)); }}>×</button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="btn-row end">
          <Button variant="soft" onClick={browse} data-testid="music-browse">Your music…</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
