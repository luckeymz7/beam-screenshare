# beam

Screen sharing in sharp, smooth quality. Public rooms are listed on the home page with a live preview; private rooms are reachable only through their link.

Built with [Astro](https://astro.build) + React and [LiveKit](https://livekit.io), the open-source media server that relays the streams.

```sh
bun install
bun run livekit   # LiveKit in dev mode (Docker), keep it running
bun run dev       # http://localhost:4321
bun run check
```

## How it works

| What | Where |
| --- | --- |
| Rooms live in LiveKit; title, visibility and host are the room's metadata | `src/lib/livekit.ts` |
| The creator's browser keeps a host key (only its hash is stored), which grants screen sharing and moderation | `src/lib/client.ts`, `src/lib/livekit.ts` |
| Share quality: **Sharp** (up to 1440p30, keeps resolution) and **Smooth** (1080p60, keeps frame rate), VP9 with a VP8 fallback | `src/components/room/share.ts` |
| Viewers always request the screen's best layer; LiveKit steps down only when a connection can't keep up | `src/components/room/RoomView.tsx` |
| Public room previews: the host uploads a small frame every 8 s | `src/components/room/useThumbnails.ts`, `src/lib/db.ts` |
| Room UI: stage, controls, participant tiles, chat, reactions, stats, picture-in-picture | `src/components/room/` |

Shortcuts in a room: **M** mic, **V** camera, **F** full screen.

## Deploy (Vercel)

Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (LiveKit Cloud) and `DATABASE_URL` / `DATABASE_AUTH_TOKEN` (Turso).
