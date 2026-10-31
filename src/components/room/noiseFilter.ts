import { useEffect } from 'react';
import { Track, type AudioProcessorOptions, type LocalAudioTrack, type TrackProcessor } from 'livekit-client';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let wasm: Promise<ArrayBuffer> | undefined;

/**
 * Noise suppression for the microphone, like Discord's: RNNoise, a small neural network trained
 * to keep voices and drop keyboards, fans and background noise, running in an AudioWorklet. Light
 * enough for phones. (Discord uses Krisp, which LiveKit only offers on LiveKit Cloud.)
 */
class NoiseFilter implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'beam-rnnoise';
  processedTrack?: MediaStreamTrack;
  private ctx?: AudioContext;
  private resume = () => void this.ctx?.resume().catch(() => {});

  async init({ track }: AudioProcessorOptions) {
    // RNNoise works on 48 kHz audio only
    const ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
    this.ctx = ctx;
    try {
      wasm ??= loadRnnoise({ url: wasmUrl, simdUrl });
      const [binary] = await Promise.all([wasm, ctx.audioWorklet.addModule(workletUrl)]);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const node = new RnnoiseWorkletNode(ctx, { wasmBinary: binary, maxChannels: 1 });
      const out = ctx.createMediaStreamDestination();
      source.connect(node).connect(out);
      this.processedTrack = out.stream.getAudioTracks()[0];
    } catch (e) {
      wasm = undefined;
      await this.destroy();
      throw e;
    }
    // A context made outside a tap starts suspended on iPhone, which would send silence
    if (ctx.state !== 'running') {
      this.resume();
      document.addEventListener('pointerdown', this.resume);
    }
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    document.removeEventListener('pointerdown', this.resume);
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    await this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}

/** Keeps the noise filter on the microphone track while `enabled`. */
export function useNoiseFilter(track: LocalAudioTrack | undefined, enabled: boolean, onError: (e: Error) => void) {
  useEffect(() => {
    if (!track) return;
    const active = track.getProcessor()?.name === 'beam-rnnoise';
    if (enabled && !active) track.setProcessor(new NoiseFilter()).catch(onError);
    else if (!enabled && active) track.stopProcessor().catch(() => {});
  }, [track, enabled, onError]);
}
