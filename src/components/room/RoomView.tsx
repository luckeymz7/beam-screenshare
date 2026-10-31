import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  VideoTrack,
  useChat,
  useDataChannel,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipantInfo,
  useParticipants,
  useRoomContext,
  useRoomInfo,
  useAudioPlayback,
  useTracks,
} from '@livekit/components-react';
import { RemoteAudioTrack, Track, type LocalAudioTrack } from 'livekit-client';
import { Icon } from '../Icon';
import { useT } from '../i18n';
import {
  forgetHostKey,
  saveHostKey,
  saveNoiseFilter,
  saveQuality,
  savedNoiseFilter,
  savedQuality,
  since,
} from '../../lib/client';
import { liveRoom, roleOf } from './meta';
import type { Role, RoomInfo } from '../../lib/livekit';
import {
  canShareScreen,
  defaultQuality,
  frameRates,
  isPremiumQuality,
  resolutions,
  shareOptions,
  toQuality,
  type FrameRate,
  type Quality,
  type Resolution,
} from './share';
import { themeStyle } from '../../lib/themes';
import { DrawLayer, COLORS } from './DrawLayer';
import { Door } from './Door';
import { Entrances } from './Entrance';
import { useStreamStats } from './useStreamStats';
import { useScreenLayer } from './useScreenLayer';
import { useNoiseFilter } from './noiseFilter';
import { useThumbnails } from './useThumbnails';
import { Tiles } from './Tiles';
import { Chat } from './Chat';

const REACTIONS = ['👏', '🔥', '😂', '❤️', '👀', '🎉'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Floating = { id: number; emoji: string; x: number; from: string };

// LiveKit's protocol number for a screen share in a permission list (TrackSource.SCREEN_SHARE)
const SCREEN_SHARE_SOURCE = 3;

// Safari's prefixed full screen and picture in picture (iPhone has no element full screen at all)
type IOSVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void;
  webkitPresentationMode?: string;
};
type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean;
};
const doc = () => document as WebkitDocument;
const fullscreenElement = () => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;
const exitFullscreen = () => (doc().exitFullscreen ? void doc().exitFullscreen() : doc().webkitExitFullscreen?.());
const elementFullscreen = () => !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);

type Toast = { text: string; action?: { label: string; href: string } };

export function RoomView({
  info: joinedInfo,
  role: joinedRole,
  hostKey: joinedHostKey,
  premium,
}: {
  info: RoomInfo;
  role: Role;
  hostKey: string | null;
  /** From the join token: unlocks the premium share qualities and drawing */
  premium: boolean;
}) {
  const t = useT();
  const room = useRoomContext();
  const local = useLocalParticipant();
  // The room and your role as they are now: the host can change settings and hand the room over
  const { metadata: roomMetadata } = useRoomInfo();
  const info = useMemo(() => liveRoom(joinedInfo, roomMetadata), [joinedInfo, roomMetadata]);
  const { metadata: myMetadata } = useParticipantInfo({ participant: local.localParticipant });
  const role = roleOf(myMetadata, joinedRole);
  const isHost = role === 'host';
  // Dev only: lets automated tests publish a fake screen without the browser's picker
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { beamRoom: typeof room }).beamRoom = room;
  }, [room]);
  // Only the count is shown: re-render when someone joins or leaves, not each time someone speaks
  const participants = useParticipants({ updateOnlyOn: [] });

  // ---- the host key: it arrives from the server when someone hands you the room
  const [hostKey, setHostKey] = useState(joinedHostKey);
  useDataChannel('host-key', (msg) => {
    // Only the server sends this (a participant's message always has a sender)
    if (msg.from) return;
    try {
      const { hostKey: key } = JSON.parse(decoder.decode(msg.payload)) as { hostKey?: string };
      if (!key) return;
      saveHostKey(info.id, key);
      setHostKey(key);
      notify(t('room.youAreHost'), 5000);
    } catch {}
  });
  // Handed the room to someone else: the old key no longer works
  useEffect(() => {
    if (role === 'guest' && hostKey) {
      forgetHostKey(info.id);
      setHostKey(null);
    }
  }, [role]);
  // Everyone hears about a new host, the old host included (the new host gets their own
  // message above). The room's name for its host changes a moment before anyone's role does,
  // so compare names rather than roles.
  const lastHost = useRef(info.host);
  useEffect(() => {
    if (info.host !== lastHost.current && info.host !== local.localParticipant.name) {
      notify(t('room.newHost', { name: info.host }), 5000);
    }
    lastHost.current = info.host;
  }, [info.host]);

  // ---- screens: several people can share when the host allows it; the newest one is on stage,
  // and the others are a click away
  const screens = useTracks([Track.Source.ScreenShare]);
  const [pinned, setPinned] = useState<string | null>(null);
  const seenScreens = useRef<string[]>([]);
  const screenIds = screens.map((s) => s.participant.identity).join(',');
  useEffect(() => {
    const ids = screenIds ? screenIds.split(',') : [];
    const added = ids.find((id) => !seenScreens.current.includes(id));
    if (added) setPinned(added);
    seenScreens.current = ids;
  }, [screenIds]);
  const screen = screens.find((s) => s.participant.identity === pinned) ?? screens[screens.length - 1];

  const stageRef = useRef<HTMLDivElement>(null);
  useScreenLayer(screen?.publication, stageRef);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef(0);
  const notify = useCallback((text: string, ms = 4000, action?: Toast['action']) => {
    setToast({ text, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);
  /** A locked feature was tried: say what it needs and where to get it */
  const upsell = (text: string) => notify(text, 6000, { label: t('premium.cta'), href: '/premium' });

  // ---- chat (kept mounted so messages arrive while the panel is closed)
  const chat = useChat();
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (chatOpen) setSeen(chat.chatMessages.length);
  }, [chatOpen, chat.chatMessages.length]);
  const unread = chatOpen ? 0 : chat.chatMessages.length - seen;

  // ---- reactions
  const [floating, setFloating] = useState<Floating[]>([]);
  const addReaction = useCallback((emoji: string, from: string) => {
    if (!REACTIONS.includes(emoji)) return;
    const id = Math.random();
    setFloating((f) => [...f.slice(-30), { id, emoji, from, x: 10 + Math.random() * 80 }]);
    setTimeout(() => setFloating((f) => f.filter((r) => r.id !== id)), 2600);
  }, []);
  const { send } = useDataChannel('reaction', (msg) => addReaction(decoder.decode(msg.payload), msg.from?.name ?? ''));
  const react = (emoji: string) => {
    send(encoder.encode(emoji), { reliable: true, topic: 'reaction' }).catch(() => {});
    addReaction(emoji, t('tile.you'));
  };

  // ---- screen share (the host; everyone when the room allows it)
  const canShare = useMemo(canShareScreen, []);
  // What LiveKit lets this person publish right now (it changes with the host's settings)
  const permissions = useLocalParticipantPermissions();
  const mayShare = permissions
    ? !!permissions.canPublishSources?.includes(SCREEN_SHARE_SOURCE as never)
    : isHost || info.share;
  const [quality, setQualityState] = useState<Quality>(() => {
    const saved = toQuality(savedQuality());
    return premium || !isPremiumQuality(saved) ? saved : defaultQuality;
  });
  const setQuality = (q: Quality) => {
    if (!premium && isPremiumQuality(q)) return upsell(t('premium.quality'));
    setQualityState(q);
    saveQuality(q);
  };
  const [shareAudio, setShareAudio] = useState(true);
  async function toggleShare() {
    try {
      if (local.isScreenShareEnabled) {
        await local.localParticipant.setScreenShareEnabled(false);
      } else {
        const { capture, publish } = shareOptions(quality, shareAudio);
        await local.localParticipant.setScreenShareEnabled(true, capture, publish);
        // Counted on the admin dashboard (the host's shares)
        if (hostKey) fetch(`/api/rooms/${info.id}/shared`, { method: 'POST', headers: { 'x-host-key': hostKey } }).catch(() => {});
        // The browser only hands over sound for a tab or the entire screen, and only with its checkbox on
        if (shareAudio && !local.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)) {
          notify(t('room.noSound'), 10_000);
        }
      }
    } catch (e) {
      // Closing the browser's picker is not an error worth showing
      if ((e as Error).name !== 'NotAllowedError') notify(t('room.shareFailed', { error: (e as Error).message }));
    }
  }
  // The home page preview follows whatever screen is on stage, the host's or a guest's
  const stageTrack = screen?.publication?.track;
  useThumbnails(info.id, hostKey, stageTrack, isHost && info.visibility === 'public' && !!stageTrack);

  // Phones can't share their screen: hand the host role to a computer instead
  const copyHostLink = async () => {
    await navigator.clipboard.writeText(`${location.origin}/r/${info.id}#host=${hostKey}`).catch(() => {});
    notify(t('room.hostLinkCopied'));
  };

  // ---- microphone noise suppression
  const [noiseFilter, setNoiseFilter] = useState(savedNoiseFilter);
  const onNoiseError = useCallback(() => {
    setNoiseFilter(false);
    notify(t('room.noiseFailed'));
  }, [notify, t]);
  useNoiseFilter(local.microphoneTrack?.track as LocalAudioTrack | undefined, noiseFilter, onNoiseError);
  const toggleNoiseFilter = () => {
    setNoiseFilter(!noiseFilter);
    saveNoiseFilter(!noiseFilter);
    notify(noiseFilter ? t('room.noiseOff') : t('room.noiseOn'), 2000);
  };

  const toggleMic = () =>
    local.localParticipant
      .setMicrophoneEnabled(!local.isMicrophoneEnabled)
      .catch((e: Error) => notify(t('room.micError', { error: e.message })));
  const toggleCam = () =>
    local.localParticipant
      .setCameraEnabled(!local.isCameraEnabled)
      .catch((e: Error) => notify(t('room.camError', { error: e.message })));

  // ---- stage: fullscreen, picture in picture, stats
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(fullscreenElement() === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);
  const stageVideo = () => stageRef.current?.querySelector('video') as IOSVideo | null | undefined;
  const toggleFullscreen = () => {
    const stage = stageRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!stage) return;
    if (fullscreenElement()) return exitFullscreen();
    if (stage.requestFullscreen) return void stage.requestFullscreen().catch(() => videoFullscreen());
    if (stage.webkitRequestFullscreen) return stage.webkitRequestFullscreen(); // older iPad Safari
    videoFullscreen();
  };
  // iPhone Safari can't put an element in full screen, only a <video> in its own player
  const videoFullscreen = () => {
    const video = stageVideo();
    if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else notify(t('room.noFullscreen'));
  };
  const pip = () => {
    const video = stageVideo();
    if (!video) return;
    if (!video.requestPictureInPicture && video.webkitSetPresentationMode) {
      return video.webkitSetPresentationMode(
        video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture',
      );
    }
    (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() =>
      notify(t('room.noPip')),
    );
  };
  // Double-click the picture for full screen, but not a quick double tap on a control (or a doodle)
  const onStageDoubleClick = (e: MouseEvent) => {
    if (!drawing && !(e.target as HTMLElement).closest('.dock, button, select, a')) toggleFullscreen();
  };

  // ---- drawing on the shared screen (premium)
  const [drawing, setDrawing] = useState(false);
  const [penColor, setPenColor] = useState(COLORS[0]);
  const toggleDrawing = () => (premium ? setDrawing(!drawing) : upsell(t('premium.draw')));
  const [showStats, setShowStats] = useState(false);
  const [selfPreview, setSelfPreview] = useState(false);
  // Start hidden again each time you share
  useEffect(() => {
    if (!local.isScreenShareEnabled) setSelfPreview(false);
  }, [local.isScreenShareEnabled]);
  const stats = useStreamStats(screen?.publication?.track, showStats);

  // Hide the controls while watching full screen and the pointer is still; a tap brings them back
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(0);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 3000);
  };

  // ---- keyboard: M mic, V camera, F full screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'm') toggleMic();
      else if (e.key === 'v') toggleCam();
      else if (e.key === 'f') toggleFullscreen();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // ---- live duration
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [copied, setCopied] = useState(false);
  const invite = async () => {
    await navigator.clipboard.writeText(location.origin + location.pathname).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const [confirmEnd, setConfirmEnd] = useState(false);
  const manage = (body: object) =>
    fetch(`/api/rooms/${info.id}/manage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-key': hostKey ?? '' },
      body: JSON.stringify(body),
    });
  const endRoom = async () => {
    if (!confirmEnd) return setConfirmEnd(true);
    await manage({ action: 'end' }).catch(() => notify(t('room.endFailed')));
  };
  // The new values come back to everyone through the room's metadata
  const changeSettings = (change: { share?: boolean; approval?: boolean }) =>
    manage({ action: 'settings', ...change })
      .then((r) => !r.ok && notify(t('room.settingsFailed')))
      .catch(() => notify(t('room.settingsFailed')));
  const makeHost = (identity: string) =>
    manage({ action: 'transfer', identity })
      .then((r) => !r.ok && notify(t('room.transferFailed')))
      .catch(() => notify(t('room.transferFailed')));

  const sharer = screen?.participant;
  const [screenAudio] = useTracks([Track.Source.ScreenShareAudio]);
  const hasSound = !!screenAudio && screenAudio.participant === sharer;
  const [streamMuted, setStreamMuted] = useState(false);
  const screenAudioTrack = screenAudio?.publication?.track;
  useEffect(() => {
    if (screenAudioTrack instanceof RemoteAudioTrack) screenAudioTrack.setVolume(streamMuted ? 0 : 1);
  }, [screenAudioTrack, streamMuted]);
  // Safari (and iPhone) may refuse to start audio until the page is tapped again; only ask when
  // there is something to hear
  const { canPlayAudio, startAudio } = useAudioPlayback(room);
  const remoteAudio = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio]).some(
    (a) => !a.participant.isLocal,
  );
  const showVideo = !!screen && (!screen.participant.isLocal || selfPreview);
  useEffect(() => {
    if (!showVideo) setDrawing(false);
  }, [showVideo]);

  return (
    // A premium host's theme tints the room
    <div
      className={`room ${chatOpen ? 'with-chat' : ''} ${info.theme ? 'themed' : ''}`}
      style={themeStyle(info.theme)}
    >
      <header className="room-bar">
        <div className="room-title">
          <h1>{info.title}</h1>
          <span className="room-sub mono">
            <span className="live-dot" /> {t('room.live', { time: since(t, info.createdAt, now) })}
            <span className="sep">·</span>
            <Icon name={info.visibility === 'public' ? 'globe' : 'lock'} size={12} />{' '}
            {info.visibility === 'public' ? t('room.public') : t('room.private')}
            <span className="sep">·</span>
            <Icon name="users" size={12} /> {participants.length}
            {info.max ? `/${info.max}` : ''}
          </span>
        </div>
        <div className="room-actions">
          <button className="btn" onClick={invite}>
            <Icon name={copied ? 'check' : 'link'} size={14} /> {copied ? t('room.copied') : t('room.invite')}
          </button>
          {isHost && (
            <details className="room-settings">
              <summary className="btn" aria-label={t('room.settings')} title={t('room.settings')}>
                <Icon name="sliders" size={14} />
              </summary>
              <div className="settings-pop">
                <p className="label">{t('room.settings')}</p>
                <label className="check">
                  <input type="checkbox" checked={info.share} onChange={(e) => changeSettings({ share: e.target.checked })} />
                  <span>
                    <strong>{t('create.share')}</strong> {t('room.shareHint')}
                  </span>
                </label>
                {info.visibility === 'private' && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={info.approval}
                      onChange={(e) => changeSettings({ approval: e.target.checked })}
                    />
                    <span>
                      <strong>{t('create.approval')}</strong> {t('create.approvalHint')}
                    </span>
                  </label>
                )}
                <p className="muted small">{t('room.makeHostHint')}</p>
              </div>
            </details>
          )}
          {isHost && (
            <button className={`btn ${confirmEnd ? 'danger' : ''}`} onClick={endRoom} onBlur={() => setConfirmEnd(false)}>
              {confirmEnd ? t('room.endConfirm') : t('room.end')}
            </button>
          )}
        </div>
      </header>

      {isHost && info.approval && hostKey && <Door roomId={info.id} hostKey={hostKey} />}

      {/* More than one person sharing: pick whose screen is on stage */}
      {screens.length > 1 && (
        <div className="screens-switch" role="group" aria-label={t('room.screens')}>
          <Icon name="screen" size={14} />
          {screens.map((s) => (
            <button
              key={s.participant.identity}
              className={`chip-btn ${s === screen ? 'on' : ''}`}
              aria-pressed={s === screen}
              onClick={() => setPinned(s.participant.identity)}
            >
              {s.participant.isLocal ? t('tile.you') : s.participant.name || s.participant.identity}
            </button>
          ))}
        </div>
      )}

      <div className="room-main">
        <div className="room-col">
          <div
            ref={stageRef}
            className={`stage ${fullscreen && idle && !drawing ? 'idle' : ''}`}
            onPointerMove={wake}
            onPointerDown={wake}
            onDoubleClick={onStageDoubleClick}
          >
            <div className="screen">
              {showVideo ? (
                <>
                  <VideoTrack trackRef={screen} className="stage-video" />
                  <DrawLayer
                    active={drawing}
                    color={penColor}
                    onColor={setPenColor}
                    onClose={() => setDrawing(false)}
                    resetKey={screen.publication?.trackSid}
                  />
                </>
              ) : screen ? (
                // Showing your own screen while sharing it makes an endless mirror and costs CPU
                <div className="stage-empty hatch">
                  <p className="stage-msg">{t('room.sharing')}</p>
                  <div className="stage-buttons">
                    <button className="btn" onClick={() => setSelfPreview(true)}>
                      {t('room.showPreview')}
                    </button>
                    <button className="btn" onClick={toggleShare}>
                      <Icon name="screenOff" size={15} /> {t('room.stopSharing')}
                    </button>
                  </div>
                  <p className="stage-hint mono">{t('room.everyoneSees')}</p>
                </div>
              ) : (
                <div className="stage-empty hatch">
                  {mayShare && canShare ? (
                    <>
                      <p className="stage-msg">{t('room.ready')}</p>
                      <button className="btn primary" onClick={toggleShare}>
                        <Icon name="screen" size={15} /> {t('room.share')}
                      </button>
                      <p className="stage-hint mono">
                        {quality.resolution} · {quality.fps} fps
                      </p>
                    </>
                  ) : isHost ? (
                    <>
                      <p className="stage-msg small">{t('room.cantShare')}</p>
                      <button className="btn" onClick={copyHostLink}>
                        <Icon name="key" size={15} /> {t('room.hostLink')}
                      </button>
                      <p className="stage-hint mono">{t('room.hostLinkHint')}</p>
                    </>
                  ) : (
                    <p className="stage-msg">{t('room.waiting', { host: info.host })}</p>
                  )}
                </div>
              )}

              {sharer && (
                <span className="stage-tag mono">
                  {sharer.isLocal ? t('room.youShare') : t('room.screenOf', { name: sharer.name || info.host })}
                  <span className="tag-sound">{hasSound ? t('room.withSound') : t('room.noSoundTag')}</span>
                  {sharer.isLocal && selfPreview && (
                    <button className="tag-btn" onClick={() => setSelfPreview(false)}>
                      {t('room.hidePreview')}
                    </button>
                  )}
                </span>
              )}

              {showStats && screen && (
                <div className="stats mono">
                  {stats ? (
                    <>
                      <span>
                        {stats.width && stats.height ? `${stats.width}×${stats.height}` : '—'} · {stats.fps ?? '—'} fps
                      </span>
                      <span>
                        {stats.bitrate ? `${(stats.bitrate / 1e6).toFixed(1)} Mbps` : '—'}
                        {stats.codec ? ` · ${stats.codec}` : ''}
                      </span>
                      {stats.limited && <span className="warn">{t('stats.limited', { reason: stats.limited })}</span>}
                      {!!stats.lost && <span>{t('stats.lost', { n: stats.lost })}</span>}
                    </>
                  ) : (
                    <span>{t('stats.measuring')}</span>
                  )}
                </div>
              )}

              {!canPlayAudio && remoteAudio && (
                <button className="sound-gate btn primary" onClick={() => startAudio()}>
                  <Icon name="volume" size={15} /> {t('room.tapSound')}
                </button>
              )}

              <Entrances />

              <div className="reactions-layer" aria-hidden="true">
                {floating.map((r) => (
                  <span key={r.id} className="float" style={{ left: `${r.x}%` }}>
                    {r.emoji}
                    {r.from && <small>{r.from}</small>}
                  </span>
                ))}
              </div>
            </div>

            {/* Over the picture on a computer, in a tray under it on a phone */}
            <div className="dock">
              {mayShare && canShare && !local.isScreenShareEnabled && (
                <div className="share-opts">
                  <label className="pick">
                    <select
                      value={quality.resolution}
                      onChange={(e) => setQuality({ ...quality, resolution: e.target.value as Resolution })}
                      aria-label={t('room.resolution')}
                      title={t('room.resolution')}
                    >
                      {(Object.keys(resolutions) as Resolution[]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                          {!premium && isPremiumQuality({ resolution: r, fps: 30 }) ? ' ✦' : ''}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron" size={12} />
                  </label>
                  <label className="pick">
                    <select
                      value={quality.fps}
                      onChange={(e) => setQuality({ ...quality, fps: Number(e.target.value) as FrameRate })}
                      aria-label={t('room.fps')}
                      title={t('room.fps')}
                    >
                      {frameRates.map((f) => (
                        <option key={f} value={f}>
                          {f} fps{!premium && isPremiumQuality({ resolution: '720p', fps: f }) ? ' ✦' : ''}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron" size={12} />
                  </label>
                  <button
                    className={`icon ${shareAudio ? 'on' : ''}`}
                    onClick={() => setShareAudio(!shareAudio)}
                    title={shareAudio ? t('room.withAudio') : t('room.withoutAudio')}
                    aria-label={shareAudio ? t('room.withAudio') : t('room.withoutAudio')}
                    aria-pressed={shareAudio}
                  >
                    <Icon name={shareAudio ? 'volume' : 'volumeOff'} size={16} />
                  </button>
                </div>
              )}

              <div className="controls">
                <button
                  className={`round ${local.isMicrophoneEnabled ? '' : 'off'}`}
                  onClick={toggleMic}
                  title={t('room.mic')}
                  aria-label={local.isMicrophoneEnabled ? t('room.mute') : t('room.unmute')}
                >
                  <Icon name={local.isMicrophoneEnabled ? 'mic' : 'micOff'} size={19} />
                </button>
                <button
                  className={`round ${local.isCameraEnabled ? '' : 'off'}`}
                  onClick={toggleCam}
                  title={t('room.cam')}
                  aria-label={local.isCameraEnabled ? t('room.camOff') : t('room.camOn')}
                >
                  <Icon name={local.isCameraEnabled ? 'camera' : 'cameraOff'} size={19} />
                </button>
                {mayShare && canShare && (
                  <button
                    className={`round share ${local.isScreenShareEnabled ? 'active' : ''}`}
                    onClick={toggleShare}
                    title={local.isScreenShareEnabled ? t('room.stopSharing') : t('room.share')}
                    aria-label={local.isScreenShareEnabled ? t('room.stopSharing') : t('room.share')}
                  >
                    <Icon name={local.isScreenShareEnabled ? 'screenOff' : 'screen'} size={19} />
                  </button>
                )}
                <button
                  className="round leave"
                  onClick={() => room.disconnect()}
                  title={t('room.leave')}
                  aria-label={t('room.leave')}
                >
                  <Icon name="leave" size={19} />
                </button>
              </div>

              <div className="corner">
                <details className="react-menu">
                  <summary className="icon" title={t('room.react')} aria-label={t('room.react')}>
                    <Icon name="smile" size={16} />
                  </summary>
                  <div className="react-pop">
                    {REACTIONS.map((e) => (
                      <button key={e} onClick={() => react(e)} aria-label={`${t('room.react')} ${e}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  className={`icon ${chatOpen ? 'on' : ''}`}
                  onClick={() => setChatOpen(!chatOpen)}
                  title={t('room.chat')}
                  aria-label={t('room.chat')}
                >
                  <Icon name="chat" size={16} />
                  {unread > 0 && <span className="unread">{unread > 9 ? '9+' : unread}</span>}
                </button>
                {showVideo && (
                  <button
                    className={`icon ${drawing ? 'on' : ''} ${premium ? '' : 'locked'}`}
                    onClick={toggleDrawing}
                    title={t('draw.title')}
                    aria-label={t('draw.title')}
                    aria-pressed={drawing}
                  >
                    <Icon name="pen" size={16} />
                  </button>
                )}
                {local.isMicrophoneEnabled && (
                  <button
                    className={`icon ${noiseFilter ? 'on' : ''}`}
                    onClick={toggleNoiseFilter}
                    title={noiseFilter ? t('room.noiseOn') : t('room.noiseOff')}
                    aria-label={t('room.noise')}
                    aria-pressed={noiseFilter}
                  >
                    <Icon name={noiseFilter ? 'wave' : 'waveOff'} size={16} />
                  </button>
                )}
                {hasSound && !sharer?.isLocal && (
                  <button
                    className={`icon ${streamMuted ? '' : 'on'}`}
                    onClick={() => setStreamMuted(!streamMuted)}
                    title={streamMuted ? t('room.streamUnmute') : t('room.streamMute')}
                    aria-label={streamMuted ? t('room.streamUnmute') : t('room.streamMute')}
                  >
                    <Icon name={streamMuted ? 'volumeOff' : 'volume'} size={16} />
                  </button>
                )}
                {screen && (
                  <>
                    <button
                      className={`icon ${showStats ? 'on' : ''}`}
                      onClick={() => setShowStats(!showStats)}
                      title={t('room.stats')}
                      aria-label={t('room.stats')}
                    >
                      <Icon name="stats" size={16} />
                    </button>
                    {showVideo && (
                      <button className="icon" onClick={pip} title={t('room.pip')} aria-label={t('room.pip')}>
                        <Icon name="pip" size={16} />
                      </button>
                    )}
                  </>
                )}
                {(elementFullscreen() || showVideo) && (
                  <button
                    className="icon"
                    onClick={toggleFullscreen}
                    title={t('room.fullscreen')}
                    aria-label={fullscreen ? t('room.exitFullscreen') : t('room.fullscreen')}
                  >
                    <Icon name={fullscreen ? 'shrink' : 'expand'} size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <Tiles isHost={isHost} onRemove={(identity) => manage({ action: 'remove', identity })} onMakeHost={makeHost} />
        </div>

        {chatOpen && <Chat chat={chat} onClose={() => setChatOpen(false)} />}
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.action && (
            // A new tab: leaving would drop you out of the room
            <a className="toast-action" href={toast.action.href} target="_blank" rel="noopener">
              {toast.action.label}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
