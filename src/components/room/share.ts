import { AudioPresets, type AudioCaptureOptions, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client';

// Safari captures at low resolution as soon as any resolution is requested (WebKit bug 263015)
const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/** Phones and tablets (iOS, Android) can't capture their screen from a browser. */
export const canShareScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/** What the host can pick, and the bitrate each resolution gets at 30 fps. */
export const resolutions = {
  '720p': { width: 1280, height: 720, mbps: 2.5 },
  '1080p': { width: 1920, height: 1080, mbps: 4.5 },
  '1440p': { width: 2560, height: 1440, mbps: 6 },
  '4K': { width: 3840, height: 2160, mbps: 12 },
} as const;
export type Resolution = keyof typeof resolutions;
export const frameRates = [15, 30, 60] as const;
export type FrameRate = (typeof frameRates)[number];
export type Quality = { resolution: Resolution; fps: FrameRate };

export const defaultQuality: Quality = { resolution: '1080p', fps: 30 };

export function toQuality(value: unknown): Quality {
  const q = value as Partial<Quality> | null;
  return {
    resolution: q?.resolution && q.resolution in resolutions ? q.resolution : defaultQuality.resolution,
    fps: frameRates.includes(q?.fps as FrameRate) ? (q!.fps as FrameRate) : defaultQuality.fps,
  };
}

// Twice the frames don't need twice the bits: consecutive frames are mostly the same
const fpsFactor: Record<FrameRate, number> = { 15: 0.65, 30: 1, 60: 1.6 };

const common: ScreenShareCaptureOptions = {
  surfaceSwitching: 'include',
  selfBrowserSurface: 'exclude',
};

/**
 * The screen's sound is music and video, not a voice: the browser's call processing (echo
 * cancellation, noise suppression, auto gain) would mangle it, and LiveKit's default for audio
 * is 48 kbps mono. Capture it untouched in stereo and send it at 128 kbps, without DTX (which
 * cuts quiet passages) or RED (which spends the bitrate on redundancy).
 */
const hifiCapture: AudioCaptureOptions & { restrictOwnAudio?: boolean } = {
  channelCount: 2,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
  // Sharing the whole screen with its sound would also capture beam playing the guests' voices,
  // sending them back as an echo. Chrome can leave this page's own audio out; others ignore it.
  restrictOwnAudio: true,
};
const hifiPublish: TrackPublishOptions = {
  audioPreset: AudioPresets.musicHighQualityStereo,
  forceStereo: true,
  dtx: false,
  red: false,
};

/**
 * VP9 as rid-based simulcast: a full-resolution stream plus a smaller one (each with frame-rate
 * steps), so the server can give a slow viewer the smaller stream instead of everyone getting a
 * worse one. Browsers without VP9 receive a VP8 backup automatically.
 *
 * `simulcast` + `scalabilityMode: 'L1T3'` must be explicit. Left implicit, livekit-client 2.23
 * still sends two streams for a VP9 screen share but describes them to the server as a single
 * SVC stream, so the server drops the full-resolution one ("duplicate layer") and every viewer
 * gets the small one. Servers older than 1.13.6 can't take VP9 simulcast; the client then falls
 * back to a single full-resolution stream on its own.
 */
const vp9: TrackPublishOptions = { videoCodec: 'vp9', backupCodec: true, simulcast: true, scalabilityMode: 'L1T3' };

/**
 * Capture and publish options for a quality. 60 fps is treated as motion (video, games: keep
 * the frame rate under pressure), anything slower as detail (text, code: keep the resolution).
 */
export function shareOptions(q: Quality, audio: boolean) {
  const r = resolutions[q.resolution];
  const motion = q.fps >= 60;
  const capture: ScreenShareCaptureOptions = {
    ...common,
    audio: audio ? hifiCapture : false,
    systemAudio: audio ? 'include' : 'exclude',
    contentHint: motion ? 'motion' : 'detail',
    ...(isSafari ? {} : { resolution: { width: r.width, height: r.height, frameRate: q.fps } }),
  };
  // setScreenShareEnabled publishes the video and its sound with the same options
  const publish: TrackPublishOptions = {
    ...vp9,
    ...hifiPublish,
    screenShareEncoding: { maxBitrate: Math.round(r.mbps * fpsFactor[q.fps] * 1e6), maxFramerate: q.fps },
    degradationPreference: motion ? 'maintain-framerate' : 'maintain-resolution',
  };
  return { capture, publish };
}
