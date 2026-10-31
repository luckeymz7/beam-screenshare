# beam

Screen sharing in the browser, in the quality you pick. Public rooms are listed on the home page with a live preview; private rooms are reachable only through their link. No accounts, no plugins.

- **Your quality:** 720p to 4K, at 15, 30 or 60 fps. VP9 simulcast with a VP8 fallback, so a slow viewer gets a smaller stream instead of everyone getting a worse one.
- **Hi-fi sound:** tab or system audio captured untouched and sent in 128 kbps stereo.
- **A room, not just a stream:** mic and camera for everyone, chat, reactions, stream stats, picture in picture, full screen (iPhone included).
- **Noise suppression on the mic,** like Discord's: [RNNoise](https://github.com/xiph/rnnoise) running in an AudioWorklet, on by default.
- **Host controls:** remove someone, end the room for everyone, or move the host role to another device with a host link.
- **Works on phones:** controls move to a tray under the picture, sized for thumbs.
- **English, Português, Español.**

Built with [Astro](https://astro.build) + React and [LiveKit](https://livekit.io), the open-source media server (SFU) that relays the streams.

## Run it

Needs [Bun](https://bun.sh) and Docker (for a local LiveKit).

```sh
bun install
bun run livekit   # LiveKit in dev mode, keep it running
bun run dev       # http://localhost:4321
bun run check
```

Without a `.env`, the app talks to that local LiveKit. See `.env.example` to use another server.

## How it works

| What | Where |
| --- | --- |
| Rooms live in LiveKit; title, visibility and host are the room's metadata | `src/lib/livekit.ts` |
| The creator's browser keeps a host key (only its hash is stored), which grants screen sharing and moderation | `src/lib/client.ts`, `src/lib/livekit.ts` |
| Share quality: resolution and frame rate turn into capture constraints, a bitrate, and whether to keep resolution (text) or frame rate (motion) under pressure | `src/components/room/share.ts` |
| Viewers always request the screen's best layer; LiveKit steps down only when a connection can't keep up | `src/components/room/RoomView.tsx` |
| Public room previews: the host uploads a small frame every 8 s | `src/components/room/useThumbnails.ts`, `src/lib/db.ts` |
| At most 5 new rooms per address every 10 minutes | `src/lib/db.ts` |
| Language from the switcher's cookie, else the browser's | `src/middleware.ts`, `src/lib/i18n.ts` |
| Room UI: stage, controls, participant tiles, chat, reactions, stats | `src/components/room/` |

Shortcuts in a room: **M** mic, **V** camera, **F** full screen.

## Deploy (Vercel)

Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (LiveKit Cloud or your own server, 1.13.6 or newer for VP9 simulcast) and `DATABASE_URL` / `DATABASE_AUTH_TOKEN` (a [Turso](https://turso.tech) database).

## License

[MIT](LICENSE)
