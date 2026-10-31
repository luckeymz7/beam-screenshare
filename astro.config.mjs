// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  env: {
    schema: {
      // LiveKit server (the SFU that forwards the streams). In dev these default to
      // `bun run livekit` (LiveKit in --dev mode); in production use LiveKit Cloud or your own.
      LIVEKIT_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      LIVEKIT_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      LIVEKIT_API_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Accounts, payments, previews and metrics: a local file by default, a Turso URL on Vercel
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', default: 'file:./data/beam.db' }),
      DATABASE_AUTH_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Login (optional for visitors). Each provider shows up only when its keys are set.
      BETTER_AUTH_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      BETTER_AUTH_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      GOOGLE_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      GOOGLE_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      DISCORD_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DISCORD_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Comma-separated emails that can open /admin
      ADMIN_EMAILS: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Premium, through AbacatePay (a monthly product created in its dashboard)
      ABACATEPAY_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      ABACATEPAY_PRODUCT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      ABACATEPAY_WEBHOOK_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'DM Sans',
      cssVariable: '--font-dm-sans',
      weights: [400, 500, 600],
      styles: ['normal'],
    },
    {
      provider: fontProviders.google(),
      name: 'Lora',
      cssVariable: '--font-lora',
      weights: [400, 500],
      styles: ['normal', 'italic'],
      fallbacks: ['serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains',
      weights: [400],
      styles: ['normal'],
      fallbacks: ['monospace'],
    },
  ],
});
