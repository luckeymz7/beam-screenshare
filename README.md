# beam

Screen sharing in the browser, in the quality you pick. Public rooms are listed on the home page with a live preview; private rooms are reachable only through their link. No plugins, and no account needed.

- **Your quality:** 720p to 1080p at up to 30 fps for everyone; 1440p, 4K and 60 fps with premium. VP9 simulcast with a VP8 fallback, so a slow viewer gets a smaller stream instead of everyone getting a worse one.
- **Hi-fi sound:** tab or system audio captured untouched and sent in 128 kbps stereo.
- **A room, not just a stream:** mic and camera for everyone, chat, reactions, stream stats, picture in picture, full screen (iPhone included).
- **Noise suppression on the mic,** like Discord's: [RNNoise](https://github.com/xiph/rnnoise) running in an AudioWorklet, on by default.
- **Private rooms that ask first** (optional): guests knock and the host lets them in or not.
- **Like Google Meet:** a limit on how many people can join, letting everyone share their screen (with a switcher when several do), and handing the host role to someone else, all changeable during the room.
- **Host controls:** remove someone, end the room for everyone, or move the host role to another device with a host link.
- **Optional accounts** with email and password, Google or Discord: a profile card (with your own picture) people see when they click you in a room.
- **Friends:** add people from a room or with your friend link, and see which friends are live (and join them) from the home page.
- **Premium** (R$ 9,84/month through AbacatePay): higher qualities, drawing on the shared screen, a theme for your profile and the rooms you host, a profile banner and an entrance animation everyone sees when you join.
- **Admin dashboard:** who is live and sharing right now, rooms, joins, sign-ups, subscribers and revenue.
- **Works on phones:** controls move to a tray under the picture, sized for thumbs.
- **English, Português, Español.**

Built with [Astro](https://astro.build) + React, [LiveKit](https://livekit.io) (the open-source media server that relays the streams), [better-auth](https://better-auth.com) and [AbacatePay](https://abacatepay.com).

## Run it

Needs [Bun](https://bun.sh) and Docker (for a local LiveKit).

```sh
bun install
bun run livekit   # LiveKit in dev mode, keep it running
bun run dev       # http://localhost:4321
bun run check
```

Without a `.env`, the app talks to that local LiveKit and keeps everything in `data/beam.db`. Email login works out of the box; Google, Discord, the admin and premium turn on as their settings are filled in (see `.env.example`).

Create an account from **Log in**, put its email in `ADMIN_EMAILS` to open `/admin`, and give yourself premium from its Users tab.

## How it works

| What | Where |
| --- | --- |
| Rooms live in LiveKit; title, visibility, host, "asks first" and the host's theme are the room's metadata | `src/lib/livekit.ts` |
| The creator's browser keeps a host key (only its hash is stored), which grants screen sharing and moderation | `src/lib/client.ts`, `src/lib/livekit.ts` |
| A logged-in person's profile and premium status are signed into their join token, so nobody can fake them | `src/lib/users.ts`, `src/pages/api/rooms/[id]/token.ts` |
| Knocking: the guest's browser files a request (only a hash of its secret is kept) and polls; the host polls the door | `src/lib/requests.ts`, `src/components/room/Door.tsx` |
| Share quality: resolution and frame rate turn into capture constraints, a bitrate, and whether to keep resolution (text) or frame rate (motion) under pressure | `src/components/room/share.ts` |
| Each viewer asks for the stream size it actually shows | `src/components/room/useScreenLayer.ts` |
| Drawing: strokes relative to the picture, sent over LiveKit's data channel, drawn only if the sender is premium | `src/components/room/DrawLayer.tsx` |
| Premium: AbacatePay subscription checkout; webhooks (secret + HMAC checked, each handled once) extend `premium_until` by a paid month | `src/lib/billing.ts` |
| Admin numbers: an `events` table (rooms, joins, shares, sign-ups, new premium) plus LiveKit's live view | `src/lib/events.ts`, `src/components/admin/` |
| Public room previews: the host uploads a small frame every 8 s | `src/components/room/useThumbnails.ts`, `src/lib/thumbs.ts` |
| At most 5 new rooms per address every 10 minutes | `src/lib/thumbs.ts` |
| Friends: one row per pair; who is live comes from LiveKit (cached 15 s), with room links only for public rooms and rooms that ask first | `src/lib/friends.ts` |
| Email + password login, rate-limited in the database; a Google/Discord login never merges into an unverified email account | `src/lib/auth.ts` |
| Language from the switcher's cookie, else the browser's | `src/middleware.ts`, `src/lib/i18n.ts` |

Shortcuts in a room: **M** mic, **V** camera, **F** full screen.

## Deploy (Vercel)

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: LiveKit Cloud or your own server (1.13.6 or newer for VP9 simulcast).
- `DATABASE_URL`, `DATABASE_AUTH_TOKEN`: a [Turso](https://turso.tech) database. Tables are created on first use.
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and the Google / Discord keys for login.
- `ADMIN_EMAILS` for the dashboard.
- `ABACATEPAY_API_KEY`, `ABACATEPAY_PRODUCT_ID`, `ABACATEPAY_WEBHOOK_SECRET` for premium.

## License

[MIT](LICENSE)
