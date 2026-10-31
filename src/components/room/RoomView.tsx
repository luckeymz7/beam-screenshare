import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VideoTrack,
  useChat,
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import { RemoteTrackPublication, Track, VideoQuality, type LocalVideoTrack } from 'livekit-client';
import { Icon } from '../Icon';
import { since } from '../../lib/client';
import type { Role, RoomInfo } from '../../lib/livekit';
import { shareModes, type ShareMode } from './share';
import { useStreamStats } from './useStreamStats';
import { useThumbnails } from './useThumbnails';
import { Tiles } from './Tiles';
import { Chat } from './Chat';

const REACTIONS = ['👏', '🔥', '😂', '❤️', '👀', '🎉'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Floating = { id: number; emoji: string; x: number; from: string };

export function RoomView({ info, role, hostKey }: { info: RoomInfo; role: Role; hostKey: string | null }) {
  const room = useRoomContext();
  const isHost = role === 'host';
  // Dev only: lets automated tests publish a fake screen without the browser's picker
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { beamRoom: typeof room }).beamRoom = room;
  }, [room]);
  const participants = useParticipants();
  const [screen] = useTracks([Track.Source.ScreenShare]);
  const local = useLocalParticipant();

  // Always receive the shared screen at its best layer
  useEffect(() => {
    const pub = screen?.publication;
    if (pub instanceof RemoteTrackPublication) pub.setVideoQuality(VideoQuality.HIGH);
  }, [screen?.publication]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

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
    addReaction(emoji, 'you');
  };

  // ---- screen share (host)
  const [mode, setMode] = useState<ShareMode>('sharp');
  const [shareAudio, setShareAudio] = useState(true);
  async function toggleShare() {
    try {
      if (local.isScreenShareEnabled) {
        await local.localParticipant.setScreenShareEnabled(false);
      } else {
        const m = shareModes[mode];
        await local.localParticipant.setScreenShareEnabled(true, m.capture(shareAudio), m.publish);
      }
    } catch (e) {
      // Closing the browser's picker is not an error worth showing
      if ((e as Error).name !== 'NotAllowedError') notify(`Could not share: ${(e as Error).message}`);
    }
  }
  const localScreen = local.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack as
    | LocalVideoTrack
    | undefined;
  useThumbnails(info.id, hostKey, localScreen, isHost && info.visibility === 'public' && local.isScreenShareEnabled);

  const toggleMic = () =>
    local.localParticipant
      .setMicrophoneEnabled(!local.isMicrophoneEnabled)
      .catch((e: Error) => notify(`Microphone: ${e.message}`));
  const toggleCam = () =>
    local.localParticipant.setCameraEnabled(!local.isCameraEnabled).catch((e: Error) => notify(`Camera: ${e.message}`));

  // ---- stage: fullscreen, picture in picture, stats
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen().catch(() => {});
  const pip = () => {
    const video = stageRef.current?.querySelector('video');
    if (!video) return;
    (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() =>
      notify('Picture in picture is not available in this browser.'),
    );
  };
  const [showStats, setShowStats] = useState(false);
  const [selfPreview, setSelfPreview] = useState(false);
  // Start hidden again each time you share
  useEffect(() => {
    if (!local.isScreenShareEnabled) setSelfPreview(false);
  }, [local.isScreenShareEnabled]);
  const stats = useStreamStats(screen?.publication?.track, showStats);

  // Hide the controls while watching full screen and the mouse is still
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(0);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
  };

  // ---- keyboard: M mic, V camera, F full screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, [contenteditable]')) return;
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
    await navigator.clipboard.writeText(location.href).catch(() => {});
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
    await manage({ action: 'end' }).catch(() => notify('Could not end the room.'));
  };

  const sharer = screen?.participant;
  const showVideo = !!screen && (!screen.participant.isLocal || selfPreview);

  return (
    <div className={`room ${chatOpen ? 'with-chat' : ''}`}>
      <header className="room-bar">
        <div className="room-title">
          <h1>{info.title}</h1>
          <span className="room-sub mono">
            <span className="live-dot" /> live {since(info.createdAt, now)}
            <span className="sep">·</span>
            <Icon name={info.visibility === 'public' ? 'globe' : 'lock'} size={12} /> {info.visibility}
            <span className="sep">·</span>
            <Icon name="users" size={12} /> {participants.length}
          </span>
        </div>
        <div className="room-actions">
          <button className="btn" onClick={invite}>
            <Icon name={copied ? 'check' : 'link'} size={14} /> {copied ? 'Copied' : 'Invite'}
          </button>
          {isHost && (
            <button className={`btn ${confirmEnd ? 'danger' : ''}`} onClick={endRoom} onBlur={() => setConfirmEnd(false)}>
              {confirmEnd ? 'End for everyone?' : 'End room'}
            </button>
          )}
        </div>
      </header>

      <div className="room-main">
        <div className="room-col">
          <div
            ref={stageRef}
            className={`stage ${fullscreen && idle ? 'idle' : ''}`}
            onMouseMove={wake}
            onDoubleClick={toggleFullscreen}
          >
            {showVideo ? (
              <VideoTrack trackRef={screen} className="stage-video" />
            ) : screen ? (
              // Showing your own screen while sharing it makes an endless mirror and costs CPU
              <div className="stage-empty hatch">
                <p className="stage-msg">You're sharing your screen.</p>
                <div className="stage-buttons">
                  <button className="btn" onClick={() => setSelfPreview(true)}>
                    Show preview
                  </button>
                  <button className="btn" onClick={toggleShare}>
                    <Icon name="screenOff" size={15} /> Stop sharing
                  </button>
                </div>
                <p className="stage-hint mono">Everyone in the room sees it.</p>
              </div>
            ) : (
              <div className="stage-empty hatch">
                {isHost ? (
                  <>
                    <p className="stage-msg">Ready when you are.</p>
                    <button className="btn primary" onClick={toggleShare}>
                      <Icon name="screen" size={15} /> Share your screen
                    </button>
                    <p className="stage-hint mono">{shareModes[mode].hint}</p>
                  </>
                ) : (
                  <p className="stage-msg">Waiting for {info.host} to share their screen…</p>
                )}
              </div>
            )}

            {sharer && (
              <span className="stage-tag mono">
                {sharer.isLocal ? 'you are sharing' : `${sharer.name || 'host'}'s screen`}
                {sharer.isLocal && selfPreview && (
                  <button className="tag-btn" onClick={() => setSelfPreview(false)}>
                    hide preview
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
                    {stats.limited && <span className="warn">limited by {stats.limited}</span>}
                    {!!stats.lost && <span>{stats.lost} packets lost</span>}
                  </>
                ) : (
                  <span>measuring…</span>
                )}
              </div>
            )}

            <div className="reactions-layer" aria-hidden="true">
              {floating.map((r) => (
                <span key={r.id} className="float" style={{ left: `${r.x}%` }}>
                  {r.emoji}
                  {r.from && <small>{r.from}</small>}
                </span>
              ))}
            </div>

            <div className="controls">
              <button
                className={`round ${local.isMicrophoneEnabled ? '' : 'off'}`}
                onClick={toggleMic}
                title="Microphone (M)"
                aria-label={local.isMicrophoneEnabled ? 'Mute' : 'Unmute'}
              >
                <Icon name={local.isMicrophoneEnabled ? 'mic' : 'micOff'} size={19} />
              </button>
              <button
                className={`round ${local.isCameraEnabled ? '' : 'off'}`}
                onClick={toggleCam}
                title="Camera (V)"
                aria-label={local.isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                <Icon name={local.isCameraEnabled ? 'camera' : 'cameraOff'} size={19} />
              </button>
              {isHost && (
                <button
                  className={`round share ${local.isScreenShareEnabled ? 'active' : ''}`}
                  onClick={toggleShare}
                  title={local.isScreenShareEnabled ? 'Stop sharing' : 'Share your screen'}
                  aria-label={local.isScreenShareEnabled ? 'Stop sharing' : 'Share your screen'}
                >
                  <Icon name={local.isScreenShareEnabled ? 'screenOff' : 'screen'} size={19} />
                </button>
              )}
              <button className="round leave" onClick={() => room.disconnect()} title="Leave" aria-label="Leave">
                <Icon name="leave" size={19} />
              </button>
            </div>

            <div className="corner">
              <details className="react-menu">
                <summary className="icon" title="React" aria-label="React">
                  <Icon name="smile" size={16} />
                </summary>
                <div className="react-pop">
                  {REACTIONS.map((e) => (
                    <button key={e} onClick={() => react(e)} aria-label={`React ${e}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </details>
              <button
                className={`icon ${chatOpen ? 'on' : ''}`}
                onClick={() => setChatOpen(!chatOpen)}
                title="Chat"
                aria-label="Chat"
              >
                <Icon name="chat" size={16} />
                {unread > 0 && <span className="unread">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {screen && (
                <>
                  <button
                    className={`icon ${showStats ? 'on' : ''}`}
                    onClick={() => setShowStats(!showStats)}
                    title="Stream stats"
                    aria-label="Stream stats"
                  >
                    <Icon name="stats" size={16} />
                  </button>
                  {showVideo && (
                    <button className="icon" onClick={pip} title="Picture in picture" aria-label="Picture in picture">
                      <Icon name="pip" size={16} />
                    </button>
                  )}
                </>
              )}
              <button
                className="icon"
                onClick={toggleFullscreen}
                title="Full screen (F)"
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              >
                <Icon name={fullscreen ? 'shrink' : 'expand'} size={16} />
              </button>
            </div>

            {isHost && !local.isScreenShareEnabled && (
              <div className="share-opts">
                <div className="seg" role="group" aria-label="Stream quality">
                  {(Object.keys(shareModes) as ShareMode[]).map((m) => (
                    <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} title={shareModes[m].hint}>
                      <Icon name={shareModes[m].icon} size={13} /> {shareModes[m].label}
                    </button>
                  ))}
                </div>
                <button
                  className={`icon ${shareAudio ? 'on' : ''}`}
                  onClick={() => setShareAudio(!shareAudio)}
                  title={shareAudio ? 'Sharing sound' : 'Not sharing sound'}
                  aria-label={shareAudio ? 'Share without sound' : 'Share with sound'}
                >
                  <Icon name={shareAudio ? 'volume' : 'volumeOff'} size={16} />
                </button>
              </div>
            )}
          </div>

          <Tiles isHost={isHost} onRemove={(identity) => manage({ action: 'remove', identity })} />
        </div>

        {chatOpen && <Chat chat={chat} onClose={() => setChatOpen(false)} />}
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
