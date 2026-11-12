// Renders the flat mascot poses and stickers for ../site-family/public/assets as transparent webp.
// Run: node render-family-assets.mjs   (optional ids: node render-family-assets.mjs Keep-hello Sticker-coin)
// The list of ids comes from Remotion itself (every composition named Keep-* or Sticker-*), so adding a
// pose or sticker in src/ needs no edit here. Files are written to a temp name, then renamed, so the
// browser never sees a half-written file.
import {execFileSync} from 'node:child_process';
import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const OUT = join('out', 'family');
const SITE = join('..', 'site-family', 'public', 'assets');
const FAMILY = /^(Keep|Sticker)-/;

const listed = execFileSync('npx', ['remotion', 'compositions', '--quiet'], {encoding: 'utf8'})
	.split(/\s+/)
	.filter((id) => FAMILY.test(id));
const only = process.argv.slice(2);
const ids = only.length ? listed.filter((id) => only.includes(id)) : listed;
if (!ids.length && !only.includes('XAvatar')) throw new Error(`no Keep-*/Sticker-* compositions matched (found: ${listed.join(', ') || 'none'})`);

mkdirSync(OUT, {recursive: true});
mkdirSync(SITE, {recursive: true});
const run = (cmd, args) => execFileSync(cmd, args, {stdio: 'inherit'});

for (const id of ids) {
	const png = join(OUT, id + '.png');
	run('npx', ['remotion', 'still', id, png, '--image-format=png']);
	const target = join(SITE, id.toLowerCase() + '.webp');
	const tmp = target.replace(/\.webp$/, '.tmp.webp');
	const width = id.startsWith('Keep-') ? 600 : 240;
	run('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-vf', `scale=${width}:-1`, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', '88', tmp]);
	renameSync(tmp, target);
}
// The site logo (nav, footer, favicon all read /logo.webp) is the X avatar, so the two never drift apart.
if (!only.length || only.includes('XAvatar')) {
	const png = join(OUT, 'XAvatar.png');
	run('npx', ['remotion', 'still', 'XAvatar', png, '--image-format=png']);
	const logo = join('..', 'site-family', 'public', 'logo.webp');
	run('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-vf', 'scale=256:256', '-c:v', 'libwebp', '-quality', '90', logo.replace(/\.webp$/, '.tmp.webp')]);
	renameSync(logo.replace(/\.webp$/, '.tmp.webp'), logo);
	const icon = join('..', 'site-family', 'public', 'favicon.png');
	run('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-vf', 'scale=64:64', icon.replace(/\.png$/, '.tmp.png')]);
	renameSync(icon.replace(/\.png$/, '.tmp.png'), icon);
}

// The site reads this manifest instead of keeping its own copy of the pose and sticker names.
// Always written from the full composition list, even when only some ids were re-rendered.
const MANIFEST = join('..', 'site-family', 'src', 'generated', 'asset-manifest.json');
mkdirSync(join('..', 'site-family', 'src', 'generated'), {recursive: true});
const names = (prefix) => listed.filter((id) => id.startsWith(prefix)).map((id) => id.toLowerCase());
writeFileSync(MANIFEST, JSON.stringify({poses: names('Keep-'), stickers: names('Sticker-')}, null, 2) + '\n');
console.log(`rendered ${ids.length} assets to ${SITE}; manifest at ${MANIFEST}`);
