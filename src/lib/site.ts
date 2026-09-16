export const SOCIAL = {
  x: { label: 'X', handle: '@cryptodrakaris', url: 'https://x.com/cryptodrakaris' },
  tiktok: { label: 'TikTok', handle: '@cryptodrakaris', url: 'https://www.tiktok.com/@cryptodrakaris' },
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Internal link with base path and trailing slash: href('ru', 'gallery') -> /ru/gallery/ */
export function href(lang: string, path = ''): string {
  const clean = path.replace(/^\/|\/$/g, '');
  return `${BASE}/${lang}/${clean ? clean + '/' : ''}`;
}

/** Static asset in /public with base path */
export function asset(path: string): string {
  return `${BASE}/${path.replace(/^\//, '')}`;
}
