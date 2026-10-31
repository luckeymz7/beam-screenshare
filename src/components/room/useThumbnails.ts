import { useEffect } from 'react';
import type { Track } from 'livekit-client';

const EVERY = 8_000;
const WIDTH = 640;

/**
 * In a public room, the host's browser uploads a small frame of the screen on stage every few
 * seconds for the preview on the home page: the host's own share, or a guest's when guests
 * may present. Runs off a hidden video element so it works whatever the page is showing.
 */
export function useThumbnails(roomId: string, hostKey: string | null, track: Track | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !hostKey || !track) return;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track.mediaStreamTrack]);
    video.play().catch(() => {});
    const canvas = document.createElement('canvas');
    let stopped = false;

    const upload = async () => {
      // Follow the track if its source was swapped (e.g. a restarted capture)
      const current = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
      if (current !== track.mediaStreamTrack) {
        video.srcObject = new MediaStream([track.mediaStreamTrack]);
        video.play().catch(() => {});
        return;
      }
      if (stopped || !video.videoWidth) return;
      canvas.width = WIDTH;
      canvas.height = Math.round((WIDTH * video.videoHeight) / video.videoWidth);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.72));
      // Safari can't encode WebP and silently returns PNG
      const image = blob?.type === 'image/webp' ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.75));
      if (!image || stopped) return;
      await fetch(`/api/rooms/${roomId}/thumb`, {
        method: 'PUT',
        headers: { 'Content-Type': image.type, 'x-host-key': hostKey },
        body: image,
      }).catch(() => {});
    };

    const first = setTimeout(upload, 1500);
    const id = setInterval(upload, EVERY);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(id);
      video.srcObject = null;
    };
  }, [roomId, hostKey, track, enabled]);
}
