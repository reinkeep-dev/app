// Smoke check for the "render hangs forever" bug (2026-11-10): the downloaded Chrome Headless Shell stalled
// on this Mac with no error. Renders one still with the browser chosen in remotion.config.ts and fails
// loudly if it does not finish in time. Run: npm run check:render
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, rmSync} from 'node:fs';

const LIMIT_MS = 180_000;
const OUT = 'out/check/turn-mid.png';
mkdirSync('out/check', {recursive: true});
rmSync(OUT, {force: true});

const child = spawn('npx', ['remotion', 'still', 'KeeperTurn', OUT, '--frame=30'], {stdio: 'inherit'});
const timer = setTimeout(() => {
	console.error(`FAIL: render did not finish in ${LIMIT_MS / 1000}s. Chrome is probably hanging; see remotion.config.ts.`);
	child.kill('SIGKILL');
	process.exit(1);
}, LIMIT_MS);

child.on('exit', (code) => {
	clearTimeout(timer);
	if (code !== 0 || !existsSync(OUT)) {
		console.error(`FAIL: render exited with code ${code}, image ${existsSync(OUT) ? 'exists' : 'missing'}.`);
		process.exit(1);
	}
	console.log('OK: still rendered to', OUT);
});
