// Renders the link preview card (OgCard, 1200x630) for every page in site-family/src/lib/site-pages.ts and writes
// site-family/public/og/<slug>.jpg. Run: node render-og.mjs   (needs ffmpeg on PATH)
import {execFileSync} from 'node:child_process';
import {mkdirSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {SITE_PAGES} from '../site-family/src/lib/site-pages.ts';

const OUT = join('out', 'og');
const SITE = join('..', 'site-family', 'public', 'og');
mkdirSync(OUT, {recursive: true});
mkdirSync(SITE, {recursive: true});

for (const p of Object.values(SITE_PAGES)) {
	const png = join(OUT, p.slug + '.png');
	execFileSync('npx', ['remotion', 'still', 'OgCard', png, `--props=${JSON.stringify({card: p.card, art: p.art})}`], {stdio: ['ignore', 'ignore', 'inherit']});
	// jpg: every crawler reads it, and ~10x smaller than the png. Temp name then rename, so a half file is never served.
	const tmp = join(SITE, p.slug + '.tmp.jpg');
	execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-q:v', '3', tmp]);
	renameSync(tmp, join(SITE, p.slug + '.jpg'));
	console.log('og', p.slug);
}
