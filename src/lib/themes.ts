// Theme keys. Colors and shape live in src/styles/themes.css under [data-theme='<key>'],
// self-hosted font families in src/styles/fonts.css.
export type ThemeKey =
  | 'drakaris'
  | 'lazy-lions'
  | 'gray-boys'
  | 'bubblegum-kids'
  | 'robotos'
  | 'nonconformist-ducks'
  | 'adam-bomb-squad'
  | 'mars-cats-voyage';

const KEYS: ThemeKey[] = ['drakaris', 'lazy-lions', 'gray-boys', 'bubblegum-kids', 'robotos', 'nonconformist-ducks', 'adam-bomb-squad', 'mars-cats-voyage'];
// Page background per theme for <meta name="theme-color">, mirrors --bg in themes.css
export const THEME_COLOR: Record<ThemeKey, string> = {
  drakaris: '#0b0b0d',
  'lazy-lions': '#080a0c',
  'gray-boys': '#d6f1f1',
  'bubblegum-kids': '#fd9cdc',
  robotos: '#fafafa',
  'nonconformist-ducks': '#0a0a0a',
  'adam-bomb-squad': '#ffffff',
  'mars-cats-voyage': '#131313',
};
export const isTheme = (x: string): x is ThemeKey => (KEYS as string[]).includes(x);
