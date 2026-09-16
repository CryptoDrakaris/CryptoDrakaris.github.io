// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Languages are routed by hand via src/pages/[lang]/ (see src/i18n/ui.ts),
// so Astro's built-in i18n routing stays off.
//
// SITE and BASE_PATH are set by the GitHub Pages workflow (.github/workflows/deploy.yml).
// Locally they are empty, which keeps links root-relative and skips canonical/sitemap.
export default defineConfig({
  site: process.env.SITE || undefined,
  base: process.env.BASE_PATH || undefined,
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') })],
});
