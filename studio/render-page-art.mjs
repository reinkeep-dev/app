// Renders the page illustrations as transparent 1200x900 webp into ../site-family/public/assets/pages/.
// Run: node render-page-art.mjs   (optional: node render-page-art.mjs gate receipt)
// The list comes from Remotion itself (every composition named PageArt-*), so adding one in src/page-art.tsx
// needs no edit here. Files are written to a temp name, then renamed.
import {execFileSync} from 'node:child_process';
import {mkdirSync, renameSync, statSync} from 'node:fs';
import {join} from 'node:path';

const OUT = join('out', 'pages');
const SITE = join('..', 'site-family', 'public', 'assets', 'pages');
const listed = execFileSync('npx', ['remotion', 'compositions', '--quiet'], {encoding: 'utf8'})
	.split(/\s+/)
	.filter((id) => id.startsWith('PageArt-'))
	.map((id) => id.slice('PageArt-'.length));
const only = process.argv.slice(2);
const names = only.length ? listed.filter((n) => only.includes(n)) : listed;
if (!names.length) throw new Error(`no PageArt-* compositions matched (found: ${listed.join(', ') || 'none'})`);

mkdirSync(OUT, {recursive: true});
mkdirSync(SITE, {recursive: true});
const run = (cmd, args) => execFileSync(cmd, args, {stdio: 'inherit'});

for (const name of names) {
	const png = join(OUT, name + '.png');
	run('npx', ['remotion', 'still', `PageArt-${name}`, png, '--image-format=png']);
	const target = join(SITE, name + '.webp');
	const tmp = join(SITE, name + '.tmp.webp');
	run('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', '85', tmp]);
	renameSync(tmp, target);
	console.log(`${target}: ${(statSync(target).size / 1024).toFixed(1)} KB`);
}
