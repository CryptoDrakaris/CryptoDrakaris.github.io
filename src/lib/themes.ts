// Theme registry: data-theme key -> Google Fonts families to load.
// Colors and shape live in src/styles/themes.css under [data-theme='<key>'].
export type ThemeKey = 'drakaris' | 'lazy-lions' | 'gray-boys' | 'bubblegum-kids' | 'robotos' | 'nonconformist-ducks' | 'adam-bomb-squad' | 'mars-cats-voyage';

const MONO = 'JetBrains+Mono:wght@400;500';
const ONEST = 'Onest:wght@400;500;600;700';

export const THEME_FONTS: Record<ThemeKey, string[]> = {
  drakaris: ['Unbounded:wght@500;700', ONEST, MONO],
  'lazy-lions': ['Space+Grotesk:wght@400;500;600;700', ONEST, MONO],
  'gray-boys': ['Exo+2:wght@700;800', 'Montserrat:wght@400;500;600;700', MONO],
  'bubblegum-kids': ['Nunito:wght@800;900', 'IBM+Plex+Sans:wght@400;500;600;700', 'IBM+Plex+Mono:wght@400;500'],
  robotos: ['Rubik:wght@700;900', 'IBM+Plex+Mono:wght@400;500;600;700'],
  'nonconformist-ducks': ['Anton', 'Space+Grotesk:wght@400;500;700', 'Space+Mono:wght@400;700', 'Oswald:wght@600;700', ONEST, MONO],
  'mars-cats-voyage': ['Sora:wght@400;600;700;800', ONEST, MONO],
  'adam-bomb-squad': ['Open+Sans:wdth,wght@75,700;75,800', 'Montserrat:wght@400;500;600;700', MONO],
};

// The DRAKARIS wordmark in header/footer is always Unbounded 700.
export function fontsHref(theme: ThemeKey, extra: ThemeKey[] = []) {
  const families = [...new Set([theme, ...extra].flatMap((k) => THEME_FONTS[k]))];
  if (!families.some((f) => f.startsWith('Unbounded'))) families.unshift('Unbounded:wght@700');
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;
}

export const isTheme = (x: string): x is ThemeKey => x in THEME_FONTS;
