// Premium themes, like Discord's profile themes: two colours that tint a profile card and the
// rooms its owner hosts. Shared by the server (validation) and the client (pickers, rendering).

export type Theme = { primary: string; accent: string };

export const themePresets: Record<string, Theme> = {
  midnight: { primary: '#1d2350', accent: '#8b95ff' },
  ocean: { primary: '#0d3b47', accent: '#5ec6d8' },
  forest: { primary: '#1c3a28', accent: '#8fd19e' },
  sunset: { primary: '#5a1f2e', accent: '#ffad66' },
  rose: { primary: '#4d1a35', accent: '#ff8fb8' },
  gold: { primary: '#3b2f12', accent: '#e8c45c' },
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A theme from untrusted input, or null. */
export function toTheme(value: unknown): Theme | null {
  const t = value as Partial<Theme> | null;
  if (!t || typeof t.primary !== 'string' || typeof t.accent !== 'string') return null;
  if (!HEX.test(t.primary) || !HEX.test(t.accent)) return null;
  return { primary: t.primary.toLowerCase(), accent: t.accent.toLowerCase() };
}

export function parseTheme(json: string | null | undefined): Theme | null {
  try {
    return json ? toTheme(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

/** Premium: what everyone in the room sees when you come in. */
export const entrances = ['sparkles', 'confetti', 'glow'] as const;
export type Entrance = (typeof entrances)[number];
export const toEntrance = (value: unknown): Entrance | null =>
  entrances.includes(value as Entrance) ? (value as Entrance) : null;

/** CSS custom properties for a themed element. */
export const themeStyle = (theme: Theme | null | undefined) =>
  theme ? ({ '--theme-primary': theme.primary, '--theme-accent': theme.accent } as Record<string, string>) : undefined;
