// Renders every Remotion asset and writes web-ready files into ../site/assets.
// Run: npm run render:assets   (needs ffmpeg on PATH for the webp/mp4 conversions)
// Optional: render only some ids, e.g. `node render-assets.mjs CardRules DoorBuys`.
//
// Two rules keep a browser from ever showing a half-written or stale asset:
//  1. every file is written to a temp name and then renamed into place (a rename is all-or-nothing);
//  2. after rendering, index.html gets ?v=<content hash> on every asset URL, so a changed file is a new URL.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const OUT = 'out';
const SITE_DIR = join('..', 'site');
const SITE = join(SITE_DIR, 'assets');
const INDEX = join(SITE_DIR, 'index.html');
const only = process.argv.slice(2);
const want = (id) => only.length === 0 || only.includes(id);

const run = (cmd, args) => execFileSync(cmd, args, {stdio: 'inherit'});
const remotion = (...args) => run('npx', ['remotion', ...args]);

// ffmpeg into a temp file next to the target, then rename over it.
const ffmpegTo = (target, ...args) => {
	const ext = target.slice(target.lastIndexOf('.'));
	const tmp = target.slice(0, -ext.length) + '.tmp' + ext;
	run('ffmpeg', ['-loglevel', 'error', '-y', ...args, tmp]);
	renameSync(tmp, target);
};

mkdirSync(OUT, {recursive: true});
mkdirSync(join(SITE, 'turn'), {recursive: true});

// 1. Turntable: one image per yaw step, shown by pointer position on the site.
if (want('KeeperTurn')) {
	rmSync(join(OUT, 'turn'), {recursive: true, force: true});
	remotion('render', 'KeeperTurn', join(OUT, 'turn'), '--sequence', '--image-format=png');
	const frames = readdirSync(join(OUT, 'turn')).filter((f) => f.endsWith('.png')).sort();
	frames.forEach((f, i) => {
		ffmpegTo(join(SITE, 'turn', String(i).padStart(2, '0') + '.webp'), '-i', join(OUT, 'turn', f), '-vf', 'scale=800:-1', '-quality', '82');
	});
	console.log(`turn: ${frames.length} frames`);
}

// 2. Hero background loop.
if (want('HeroField')) {
	remotion('render', 'HeroField', join(OUT, 'hero-field.mp4'), '--codec=h264', '--crf=24');
	ffmpegTo(join(SITE, 'hero-field.mp4'), '-i', join(OUT, 'hero-field.mp4'), '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an');
	ffmpegTo(join(SITE, 'hero-field.webp'), '-i', join(OUT, 'hero-field.mp4'), '-frames:v', '1', '-vf', 'scale=1280:-1', '-quality', '75');
}

// 3. Stills for cards and panels.
const STILLS = {CardGate: 'card-gate', CardRules: 'card-rules', CardReceipt: 'card-receipt', DoorPays: 'door-pays', DoorBuys: 'door-buys', SplitLayers: 'split-layers'};
for (const [id, name] of Object.entries(STILLS)) {
	if (!want(id)) continue;
	remotion('still', id, join(OUT, name + '.png'));
	ffmpegTo(join(SITE, name + '.webp'), '-i', join(OUT, name + '.png'), '-vf', 'scale=720:-1', '-quality', '84');
}

// 4. Link preview (social cards need jpg or png).
if (want('OgImage')) {
	remotion('still', 'OgImage', join(OUT, 'og.png'));
	ffmpegTo(join(SITE, 'og.jpg'), '-i', join(OUT, 'og.png'), '-q:v', '3');
}

// 5. Stamp content hashes into index.html. The turntable frames share one hash, read by hero.js from data-v.
const hashOf = (...files) => {
	const h = createHash('sha256');
	for (const f of files) h.update(readFileSync(f));
	return h.digest('hex').slice(0, 8);
};
let html = readFileSync(INDEX, 'utf8');
html = html.replace(/assets\/([a-z0-9-]+\.(?:webp|mp4|jpg))(?:\?v=[0-9a-f]+)?/g, (_, file) => `assets/${file}?v=${hashOf(join(SITE, file))}`);
const turnFiles = readdirSync(join(SITE, 'turn')).filter((f) => f.endsWith('.webp')).sort().map((f) => join(SITE, 'turn', f));
const turnHash = hashOf(...turnFiles);
html = html.replace(/assets\/turn\/(\d+\.webp)(?:\?v=[0-9a-f]+)?/g, (_, file) => `assets/turn/${file}?v=${turnHash}`);
html = html.replace(/(<canvas id="turn"[^>]*?data-v=")[0-9a-f]*(")/, `$1${turnHash}$2`);
writeFileSync(INDEX, html);
console.log('stamped asset versions into index.html');
