import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { Icon } from '../Icon';
import { useT } from '../i18n';
import { metaOf } from './meta';

export const COLORS = ['#ff5a5a', '#ffd166', '#5ee6a8', '#5ab8ff', '#ffffff'];
const MAX_STROKES = 400;
const MAX_POINTS = 2000;

type Stroke = { color: string; pts: number[] };
// p: append points to a stroke, c: clear the board
type Message = { t: 'p'; id: string; c: string; p: number[] } | { t: 'c' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Drawing on the shared screen (premium). Points are stored relative to the picture itself
 * (0–1 inside the letterboxed video), so a stroke lands on the same spot for every viewer,
 * whatever the size of their window. Strokes travel over LiveKit's data channel; viewers only
 * draw what comes from participants whose signed metadata says premium.
 */
export function DrawLayer({
  active,
  color,
  onColor,
  onClose,
  resetKey,
}: {
  active: boolean;
  color: string;
  onColor: (c: string) => void;
  onClose: () => void;
  /** The board clears when this changes (a new screen share) */
  resetKey: unknown;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(new Map<string, Stroke>());
  const dirty = useRef(true);
  const { localParticipant } = useLocalParticipant();

  const draw = useCallback(() => (dirty.current = true), []);
  const add = useCallback(
    (id: string, c: string, pts: number[]) => {
      let s = strokes.current.get(id);
      if (!s) {
        if (strokes.current.size >= MAX_STROKES) strokes.current.delete(strokes.current.keys().next().value!);
        s = { color: COLORS.includes(c) ? c : COLORS[0], pts: [] };
        strokes.current.set(id, s);
      }
      if (s.pts.length < MAX_POINTS) s.pts.push(...pts.slice(0, MAX_POINTS - s.pts.length).map((v) => Math.min(1, Math.max(0, v))));
      draw();
    },
    [draw],
  );
  const clear = useCallback(() => {
    strokes.current.clear();
    draw();
  }, [draw]);

  const { send } = useDataChannel('draw', (msg) => {
    if (!metaOf(msg.from as Participant | undefined).premium) return;
    try {
      const m = JSON.parse(decoder.decode(msg.payload)) as Message;
      if (m.t === 'c') clear();
      else if (m.t === 'p' && typeof m.id === 'string' && Array.isArray(m.p)) add(`${msg.from?.identity}:${m.id}`, m.c, m.p.filter(Number.isFinite));
    } catch {}
  });
  const publish = useCallback(
    (m: Message) => send(encoder.encode(JSON.stringify(m)), { reliable: true, topic: 'draw' }).catch(() => {}),
    [send],
  );

  useEffect(clear, [resetKey, clear]);

  // Where the picture sits inside the box (object-fit: contain leaves bars on two sides)
  const contentRect = () => {
    const el = canvas.current!;
    const video = el.parentElement?.querySelector('video');
    const W = el.clientWidth;
    const H = el.clientHeight;
    const vw = video?.videoWidth || 16;
    const vh = video?.videoHeight || 9;
    const scale = Math.min(W / vw, H / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  };

  // Redraw on the next frame when something changed; keep the canvas at device resolution
  useLayoutEffect(() => {
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const el = canvas.current;
      if (!el) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr);
      const h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
        dirty.current = true;
      }
      if (!dirty.current) return;
      dirty.current = false;
      const ctx = el.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, el.clientWidth, el.clientHeight);
      const r = contentRect();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, r.w / 320);
      for (const s of strokes.current.values()) {
        if (s.pts.length < 2) continue;
        ctx.strokeStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(r.x + s.pts[0] * r.w, r.y + s.pts[1] * r.h);
        for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(r.x + s.pts[i] * r.w, r.y + s.pts[i + 1] * r.h);
        if (s.pts.length === 2) ctx.lineTo(r.x + s.pts[0] * r.w + 0.1, r.y + s.pts[1] * r.h);
        ctx.stroke();
      }
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, []);

  // ---- my own strokes: drawn locally at once, sent in small batches
  const current = useRef<{ id: string; pending: number[] } | null>(null);
  const counter = useRef(0);
  const flush = useCallback(() => {
    const c = current.current;
    if (!c || c.pending.length === 0) return;
    publish({ t: 'p', id: c.id, c: color, p: c.pending });
    c.pending = [];
  }, [publish, color]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(flush, 50);
    return () => clearInterval(id);
  }, [active, flush]);

  const point = (e: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const r = contentRect();
    const x = (e.clientX - box.left - r.x) / r.w;
    const y = (e.clientY - box.top - r.y) / r.h;
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = `${++counter.current}`;
    current.current = { id, pending: [] };
    const p = point(e);
    add(`${localParticipant.identity}:${id}`, color, p);
    current.current.pending.push(...p);
  };
  const onMove = (e: React.PointerEvent) => {
    const c = current.current;
    if (!c) return;
    const p = point(e);
    add(`${localParticipant.identity}:${c.id}`, color, p);
    c.pending.push(...p);
  };
  const onUp = () => {
    flush();
    current.current = null;
  };

  return (
    <>
      <canvas
        ref={canvas}
        className={`draw-layer ${active ? 'drawing' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-hidden="true"
      />
      {active && (
        <div className="draw-tools" role="toolbar" aria-label={t('draw.tools')}>
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => onColor(c)}
              aria-label={c}
              aria-pressed={c === color}
            />
          ))}
          <button
            className="icon"
            onClick={() => {
              clear();
              publish({ t: 'c' });
            }}
            title={t('draw.clear')}
            aria-label={t('draw.clear')}
          >
            <Icon name="trash" size={15} />
          </button>
          <button className="icon" onClick={onClose} title={t('draw.done')} aria-label={t('draw.done')}>
            <Icon name="check" size={15} />
          </button>
        </div>
      )}
    </>
  );
}
