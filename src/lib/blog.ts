import { getCollection } from 'astro:content';
import { LOCALE, type Lang } from '../i18n/ui';

export async function postsFor(lang: Lang) {
  const all = await getCollection('blog', (e) => e.id.startsWith(`${lang}/`) && !e.data.draft);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export const postSlug = (id: string) => id.split('/').slice(1).join('/');

export const formatDate = (lang: Lang, d: Date) =>
  d.toLocaleDateString(LOCALE[lang], { year: 'numeric', month: 'long', day: 'numeric' });
