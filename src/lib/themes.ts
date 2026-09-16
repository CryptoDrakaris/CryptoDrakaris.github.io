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
export const isTheme = (x: string): x is ThemeKey => (KEYS as string[]).includes(x);
