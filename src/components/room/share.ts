import { AudioPresets, type AudioCaptureOptions, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client';
import type { IconName } from '../../lib/icons';

export type ShareMode = 'sharp' | 'smooth';

// Safari captures at low resolution as soon as any resolution is requested (WebKit bug 263015)
const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

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
const hifiCapture: AudioCaptureOptions = {
  channelCount: 2,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
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

// setScreenShareEnabled publishes the video and its sound with the same options
const base: TrackPublishOptions = { ...vp9, ...hifiPublish };
export const shareModes: Record<
  ShareMode,
  { label: string; hint: string; icon: IconName; capture: (audio: boolean) => ScreenShareCaptureOptions; publish: TrackPublishOptions }
> = {
  sharp: {
    label: 'Sharp',
    hint: 'Text and code · up to 1440p30',
    icon: 'text',
    capture: (audio) => ({
      ...common,
      audio: audio ? hifiCapture : false,
      systemAudio: audio ? 'include' : 'exclude',
      contentHint: 'detail',
      ...(isSafari ? {} : { resolution: { width: 2560, height: 1440, frameRate: 30 } }),
    }),
    publish: {
      ...base,
      screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
      // Under pressure, drop frames before dropping resolution so text stays readable
      degradationPreference: 'maintain-resolution',
    },
  },
  smooth: {
    label: 'Smooth',
    hint: 'Video and games · 1080p60',
    icon: 'film',
    capture: (audio) => ({
      ...common,
      audio: audio ? hifiCapture : false,
      systemAudio: audio ? 'include' : 'exclude',
      contentHint: 'motion',
      ...(isSafari ? {} : { resolution: { width: 1920, height: 1080, frameRate: 60 } }),
    }),
    publish: {
      ...base,
      screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
      degradationPreference: 'maintain-framerate',
    },
  },
};
