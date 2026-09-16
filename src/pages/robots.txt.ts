import type { APIRoute } from 'astro';

// Absolute sitemap URL, which robots.txt requires, is only known when `site` is set (CI build).
// BASE_URL keeps the repo sub-path of project GitHub Pages.
export const GET: APIRoute = ({ site }) => {
  const lines = ['User-agent: *', 'Allow: /'];
  if (site) {
    const path = `${import.meta.env.BASE_URL}/sitemap-index.xml`.replace(/\/{2,}/g, '/');
    lines.push('', `Sitemap: ${new URL(path, site).href}`);
  }
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
