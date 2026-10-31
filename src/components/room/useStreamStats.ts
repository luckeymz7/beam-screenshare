import { useEffect, useState } from 'react';
import { LocalVideoTrack, RemoteVideoTrack, type Track } from 'livekit-client';

export type StreamStats = {
  width?: number;
  height?: number;
  fps?: number;
  /** bits per second */
  bitrate?: number;
  codec?: string;
  lost?: number;
  /** why the sender is lowering quality (cpu / bandwidth), sender side only */
  limited?: string;
};

/** Samples the WebRTC stats of a video track once per second while `enabled`. */
export function useStreamStats(track: Track | undefined, enabled: boolean) {
  const [stats, setStats] = useState<StreamStats | null>(null);

  useEffect(() => {
    if (!enabled || !track) {
      setStats(null);
      return;
    }
    let prev: { at: number; bytes: number; frames: number } | undefined;

    const sample = async () => {
      const at = performance.now();
      if (track instanceof RemoteVideoTrack) {
        const s = await track.getReceiverStats();
        if (!s) return;
        const bytes = s.bytesReceived ?? 0;
        const elapsed = prev ? (at - prev.at) / 1000 : 0;
        setStats({
          width: s.frameWidth,
          height: s.frameHeight,
          fps: prev && elapsed ? Math.round((s.framesDecoded - prev.frames) / elapsed) : undefined,
          bitrate: prev && elapsed ? ((bytes - prev.bytes) * 8) / elapsed : undefined,
          codec: s.mimeType?.replace('video/', ''),
          lost: s.packetsLost,
        });
        prev = { at, bytes, frames: s.framesDecoded };
      } else if (track instanceof LocalVideoTrack && track.sender) {
        // Read the raw WebRTC stats: the negotiation can leave idle encodings next to the one
        // actually sending (single-stream VP9), and those report no size or frame rate.
        const report = await track.sender.getStats();
        const outbound: RTCOutboundRtpStreamStats[] = [];
        report.forEach((r) => r.type === 'outbound-rtp' && r.kind === 'video' && outbound.push(r));
        if (outbound.length === 0) return;
        const top = outbound.reduce((a, b) => ((b.frameWidth ?? 0) > (a.frameWidth ?? 0) ? b : a));
        const bytes = outbound.reduce((sum, r) => sum + (r.bytesSent ?? 0), 0);
        const frames = outbound.reduce((sum, r) => sum + (r.framesEncoded ?? 0), 0);
        const codec = top.codecId ? (report.get(top.codecId) as RTCRtpCodec | undefined)?.mimeType : undefined;
        const limit = (top as { qualityLimitationReason?: string }).qualityLimitationReason;
        const elapsed = prev ? (at - prev.at) / 1000 : 0;
        setStats({
          width: top.frameWidth,
          height: top.frameHeight,
          fps: prev && elapsed ? Math.round((frames - prev.frames) / elapsed) : undefined,
          bitrate: prev && elapsed ? ((bytes - prev.bytes) * 8) / elapsed : undefined,
          codec: codec?.replace('video/', ''),
          limited: limit && limit !== 'none' ? limit : undefined,
        });
        prev = { at, bytes, frames };
      }
    };

    sample();
    const id = setInterval(sample, 1000);
    return () => clearInterval(id);
  }, [track, enabled]);

  return stats;
}
