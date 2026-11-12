import {existsSync} from 'node:fs';
import {Config} from '@remotion/cli/config';

// Three.js needs a real GL backend inside headless Chrome.
Config.setChromiumOpenGlRenderer('angle');
Config.setEntryPoint('./src/index.ts');

// On the Mac mini this project is built on, the Chrome Headless Shell that Remotion downloads hangs
// before it loads any page (tested 2026-11-10: it never returns, even for an empty page with the GPU off),
// while the installed Google Chrome renders fine. So prefer an installed Chrome when there is one.
// Override with REMOTION_CHROME=/path/to/chrome; with neither, Remotion uses its own download.
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = process.env.REMOTION_CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : null);
if (chrome) Config.setBrowserExecutable(chrome);

// 8 GB machine: two tabs at a time keeps WebGL renders from running out of memory.
Config.setConcurrency(2);
