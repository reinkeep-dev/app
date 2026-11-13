// One list of the site's pages and how each one looks when shared or searched. Three readers:
//   - the pages themselves (browser tab title),
//   - vite.config.ts, which writes dist/<slug>.html per page with its own title, description and link card
//     (X, Telegram and Discord read the HTML only; they never run the app),
//   - studio/render-og.mjs, which renders public/og/<slug>.jpg (1200x630) with Remotion from `card` and `art`.
// Copy comes from each page's own hero, so a shared link says what the page says.

export type SitePage = {
  path: string
  slug: string // file name for dist/<slug>.html and public/og/<slug>.jpg
  title: string // browser tab and og:title
  description: string // meta description and og:description
  card: string // the big line on the share image
  art: string // studio PAGE_ART key, or 'home' for Keep waving
}

export const SITE_URL = 'https://reinkeep.xyz'
export const X_HANDLE = '@reinkeep'

export const pageTitle = (name: string) => `${name} · Reinkeep AI`

export const SITE_PAGES = {
  home: {
    path: '/', slug: 'index', art: 'home',
    title: 'Reinkeep AI: the pre-trade gate for AI agents',
    card: 'Your agent pays.\nYou hold the reins.',
    description: 'Before your AI agent pays on Robinhood Chain, Reinkeep checks your rules and answers ALLOW, REVIEW or BLOCK with a signed receipt. 25 free checks a day. Reviewed by our team, no outside audit yet.',
  },
  gate: {
    path: '/gate', slug: 'gate', art: 'gate', title: pageTitle('Gate'),
    card: 'Run a payment through the gate.',
    description: 'Fill in what your agent is about to pay. You get ALLOW, REVIEW or BLOCK, every rule that decided it, and a receipt you can verify.',
  },
  check: {
    path: '/check', slug: 'check', art: 'check', title: pageTitle('Check'),
    card: 'Look at a token before you buy.',
    description: 'Free, no account. Paste a token address from Robinhood Chain and the gate reads the contract.',
  },
  board: {
    path: '/board', slug: 'board', art: 'launches', title: pageTitle('Launch board'),
    card: 'Every launch day, side by side.',
    description: 'Each UTC day of the last two weeks: pools our collector saw, how many were re-checked a day later, and the share still trading.',
  },
  odds: {
    path: '/odds', slug: 'odds', art: 'odds', title: pageTitle('Odds'),
    card: 'How many tokens like this still trade a day later.',
    description: 'Every launch our collector sees is re-checked after 24 hours, grouped by how it started. A record of past tokens, not a prediction.',
  },
  radar: {
    path: '/radar', slug: 'radar', art: 'radar', title: pageTitle('Ticker radar'),
    card: 'Spot a wave of copies early.',
    description: 'Tickers used by two or more new tokens in the last 48 hours, with the earliest token and the busiest one.',
  },
  autopsy: {
    path: '/autopsy', slug: 'autopsy', art: 'autopsy', title: pageTitle('Autopsy'),
    card: 'What happened to one token in its first day.',
    description: 'Paste a token address. See its numbers when we first saw it and a day later, and which pattern it fits: still trading, liquidity pulled, faded, or never lived.',
  },
  premortem: {
    path: '/premortem', slug: 'premortem', art: 'premortem', title: pageTitle('Pre-mortem'),
    card: 'See what agents will see, before you launch.',
    description: 'Describe your token. Get the answer the gate would give agents buying it, the risks with fixes, and how launches like it did a day later.',
  },
  docs: {
    path: '/docs', slug: 'docs', art: 'docs', title: pageTitle('Docs'),
    card: 'Everything an agent needs, in plain words.',
    description: 'One call before every payment. The endpoints, the rules, paying, receipts and MCP.',
  },
  status: {
    path: '/status', slug: 'status', art: 'status', title: pageTitle('Status'),
    card: 'Is the gate up right now?',
    description: 'Live from the gate itself. Each part it depends on is checked when you open the page.',
  },
} satisfies Record<string, SitePage>
