import { useEffect, type RefObject } from 'react';
import { RemoteTrackPublication, type TrackPublication } from 'livekit-client';

type IOSVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitPresentationMode?: string };

const video = (stage: HTMLElement | null) => stage?.querySelector('video') as IOSVideo | null | undefined;
const inPip = (v: IOSVideo | null | undefined) =>
  !!document.pictureInPictureElement || v?.webkitPresentationMode === 'picture-in-picture';

/**
 * Receives the shared screen at the size it is shown, not always at full size: the host sends a
 * full and a half-size stream, and a phone showing the screen 360px wide only needs the small one,
 * which is a quarter of the pixels to decode (the main reason phones got hot). Full screen asks
 * for the full stream again. While the page is in the background (and not in picture in picture)
 * the video is paused entirely; the sound keeps playing, it's a separate track.
 *
 * Needs a LiveKit server that accepts VP9 simulcast (1.13.6+); older ones only get one stream.
 */
export function useScreenLayer(publication: TrackPublication | undefined, stageRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pub = publication;
    const stage = stageRef.current;
    if (!(pub instanceof RemoteTrackPublication) || !stage) return;
    // Past 2x, extra device pixels don't make text easier to read
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const update = () => {
      const v = video(stage);
      if (document.hidden && !inPip(v)) return pub.setEnabled(false);
      pub.setEnabled(true);
      if (inPip(v)) return;
      // iPhone's own full-screen player isn't the stage, so measure the screen instead (landscape:
      // iOS reports screen size in portrait whatever the rotation)
      const long = Math.max(screen.width, screen.height);
      const box = v?.webkitDisplayingFullscreen
        ? { width: long, height: Math.round((long * 9) / 16) }
        : (stage.querySelector('.screen') ?? stage).getBoundingClientRect();
      pub.setVideoDimensions({ width: Math.round(box.width * dpr), height: Math.round(box.height * dpr) });
    };

    update();
    const resize = new ResizeObserver(update);
    resize.observe(stage);
    // Captured, so they arrive from the <video> even though they don't bubble
    const events = ['visibilitychange', 'webkitbeginfullscreen', 'webkitendfullscreen', 'enterpictureinpicture', 'leavepictureinpicture'];
    events.forEach((e) => document.addEventListener(e, update, true));
    return () => {
      resize.disconnect();
      events.forEach((e) => document.removeEventListener(e, update, true));
    };
  }, [publication, stageRef]);
}
