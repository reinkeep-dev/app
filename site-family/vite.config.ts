import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { SITE_PAGES, SITE_URL, X_HANDLE, type SitePage } from './src/lib/site-pages.ts'

const MARK = '<!-- seo: filled per page at build time from src/lib/site-pages.ts (vite.config.ts) -->'
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Title, description and the link card (Open Graph + X) for one page.
function seoHead(p: SitePage): string {
  const url = SITE_URL + p.path
  const image = `${SITE_URL}/og/${p.slug}.jpg`
  const alt = p.card.replace(/\n/g, ' ')
  return [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Reinkeep AI" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="${X_HANDLE}" />`,
  ].join('\n    ')
}

// Crawlers that build link previews (X, Telegram, Discord, Slack) read the HTML and never run the app, so every
// page gets its own file: dist/gate.html is served at /gate. Home fills index.html itself. Also writes sitemap.xml.
function seoPages(): Plugin {
  const { home, ...rest } = SITE_PAGES
  return {
    name: 'reinkeep-seo-pages',
    transformIndexHtml: (html) => {
      if (!html.includes(MARK)) throw new Error('index.html lost the seo marker')
      return html.replace(MARK, seoHead(home))
    },
    writeBundle(options) {
      const dir = options.dir ?? 'dist'
      const index = readFileSync(path.join(dir, 'index.html'), 'utf8')
      const homeHead = seoHead(home)
      for (const p of Object.values(rest)) writeFileSync(path.join(dir, p.slug + '.html'), index.replace(homeHead, seoHead(p)))
      const urls = Object.values(SITE_PAGES).map((p) => `  <url><loc>${SITE_URL}${p.path}</loc></url>`).join('\n')
      writeFileSync(path.join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)
    },
  }
}

// Static build (dist/) for Cloudflare static hosting. The gate engine is the same pure module the
// old site uses (../site/engine/policy.js), imported through @engine so there is one copy of it.
export default defineConfig({
  plugins: [react(), tailwindcss(), seoPages()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@engine': path.resolve(import.meta.dirname, '../site/engine'),
      '@data': path.resolve(import.meta.dirname, '../site/data'),
    },
  },
  server: { fs: { allow: ['..'] } },
})
