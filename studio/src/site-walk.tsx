import React, {useEffect, useState} from 'react';
import {
	AbsoluteFill,
	Audio,
	Easing,
	OffthreadVideo,
	Sequence,
	continueRender,
	delayRender,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {GOLD, INK, KeepMascot, type Pose} from './keep-mascot';

// X clip in the Oqtra-style "real screen, typed caption" format, in Reinkeep's own world (cream, Keep, Inter).
// The footage is a real screen recording of reinkeep.xyz (chrome-devtools screencast, 1264x800 CSS px,
// see ../clips-x/<name>/NOTE.md). Nothing on the page is edited; the camera only frames it.

export const FPS = 30;
const W = 1600;
const H = 900;
const SRC_W = 1264;
const SRC_H = 800;
const CREAM = '#F7F6F3';
const SANS = '"Inter Site", system-ui, sans-serif';
const INTRO = 54; // 1.8 s
const OUTRO = 75; // 2.5 s
const CARD = {x: 80, y: 36, w: 1440, h: 750}; // footage window; caption line sits under it

type Rect = {x: number; y: number; w: number}; // source px, height = w * CARD.h / CARD.w
export type WalkProps = {
	clip: string;
	from: number; // source seconds
	to: number;
	keys: {t: number; r: Rect}[]; // camera keyframes in source seconds
	captions: {t: number; text: string}[]; // caption starts in source seconds, each runs to the next
	hook: string;
	pose: Pose;
	url: string;
};

export const walkFrames = (p: WalkProps) => INTRO + Math.round((p.to - p.from) * FPS) + OUTRO;

function useInter() {
	const [handle] = useState(() => delayRender('load Inter'));
	useEffect(() => {
		new FontFace('Inter Site', `url(${staticFile('fonts/inter-latin-wght.woff2')}) format('woff2')`, {weight: '100 900'})
			.load()
			.then((f) => {
				document.fonts.add(f);
				continueRender(handle);
			});
	}, [handle]);
}

const ease = Easing.inOut(Easing.cubic);
const RH = CARD.h / CARD.w;

function camAt(keys: WalkProps['keys'], t: number): Rect {
	if (t <= keys[0].t) return keys[0].r;
	for (let i = 1; i < keys.length; i++) {
		const a = keys[i - 1];
		const b = keys[i];
		if (t <= b.t) {
			const p = ease((t - a.t) / (b.t - a.t));
			return {x: a.r.x + (b.r.x - a.r.x) * p, y: a.r.y + (b.r.y - a.r.y) * p, w: a.r.w + (b.r.w - a.r.w) * p};
		}
	}
	return keys[keys.length - 1].r;
}

// Keeps a rect inside the recording so the card never shows past the page edge.
const clampRect = (r: Rect): Rect => {
	const w = Math.min(r.w, SRC_W, SRC_H / RH);
	return {w, x: Math.max(0, Math.min(r.x, SRC_W - w)), y: Math.max(0, Math.min(r.y, SRC_H - w * RH))};
};

const Typed: React.FC<{text: string; start: number; style: React.CSSProperties; caret?: boolean}> = ({text, start, style, caret = true}) => {
	const frame = useCurrentFrame();
	const n = Math.max(0, Math.floor((frame - start) * 1.5));
	const shown = text.slice(0, n);
	const done = n >= text.length;
	const blink = done ? Math.floor((frame - start) / 15) % 2 === 0 : true;
	return (
		<div style={style}>
			{shown}
			{caret && <span style={{opacity: blink ? 1 : 0, color: GOLD, fontWeight: 400}}>|</span>}
		</div>
	);
};

const KeepAt: React.FC<{pose: Pose; size: number; x: number; y: number; at: number}> = ({pose, size, x, y, at}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame: frame - at, fps, config: {damping: 12, stiffness: 140}});
	const bob = Math.sin((frame / fps) * Math.PI * 1.5) * 6;
	return (
		<div style={{position: 'absolute', left: x, top: y + bob, width: size, height: size, transform: `scale(${s})`, transformOrigin: '50% 90%'}}>
			<KeepMascot pose={pose} />
		</div>
	);
};

const Intro: React.FC<{hook: string; pose: Pose}> = ({hook, pose}) => (
	<AbsoluteFill style={{background: CREAM}}>
		<KeepAt pose={pose} size={360} x={150} y={270} at={0} />
		<Typed
			text={hook}
			start={6}
			style={{position: 'absolute', left: 560, top: 330, width: 900, fontFamily: SANS, fontWeight: 800, fontSize: 76, lineHeight: 1.05, letterSpacing: -2, color: INK}}
		/>
	</AbsoluteFill>
);

const Outro: React.FC<{url: string}> = ({url}) => {
	const frame = useCurrentFrame();
	const rise = interpolate(frame, [0, 10], [24, 0], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
	return (
		<AbsoluteFill style={{background: CREAM}}>
			<KeepAt pose="hello" size={340} x={630} y={150} at={0} />
			<div style={{position: 'absolute', top: 560 + rise, width: '100%', textAlign: 'center', fontFamily: SANS, fontWeight: 800, fontSize: 70, letterSpacing: -1.5, color: INK}}>
				{url}
			</div>
			<div style={{position: 'absolute', top: 660 + rise, width: '100%', textAlign: 'center', fontFamily: SANS, fontWeight: 500, fontSize: 30, color: '#6B6760'}}>
				Free. Robinhood Chain.
			</div>
		</AbsoluteFill>
	);
};

const Walk: React.FC<WalkProps> = (p) => {
	const frame = useCurrentFrame();
	const t = p.from + frame / FPS;
	const cam = clampRect(camAt(p.keys, t));
	const k = CARD.w / cam.w;
	const rise = interpolate(frame, [0, 9], [30, 0], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
	const cap = [...p.captions].reverse().find((c) => t >= c.t) ?? p.captions[0];
	const capStart = Math.round((Math.max(cap.t, p.from) - p.from) * FPS);
	return (
		<AbsoluteFill style={{background: CREAM}}>
			<div
				style={{
					position: 'absolute',
					left: CARD.x,
					top: CARD.y + rise,
					width: CARD.w,
					height: CARD.h,
					borderRadius: 26,
					overflow: 'hidden',
					background: '#fff',
					boxShadow: '0 30px 60px rgba(60,48,20,0.14), 0 0 0 1px rgba(26,26,26,0.06)',
				}}
			>
				<OffthreadVideo
					src={staticFile(`walk/${p.clip}.mp4`)}
					startFrom={Math.round(p.from * FPS)}
					muted
					style={{position: 'absolute', left: -cam.x * k, top: -cam.y * k, width: SRC_W * k, height: SRC_H * k, maxWidth: 'none'}}
				/>
			</div>
			<div style={{position: 'absolute', left: CARD.x + 6, top: CARD.y + CARD.h + 34, display: 'flex', alignItems: 'center', gap: 18}}>
				<div style={{width: 14, height: 14, borderRadius: 7, background: GOLD}} />
				<Typed key={cap.text} text={cap.text} start={capStart} style={{fontFamily: SANS, fontWeight: 600, fontSize: 40, color: INK, letterSpacing: -0.5}} />
			</div>
		</AbsoluteFill>
	);
};

export const SiteWalk: React.FC<WalkProps> = (p) => {
	useInter();
	const total = walkFrames(p);
	const main = total - INTRO - OUTRO;
	const music = (f: number) => interpolate(f, [0, 8, total - 30, total], [0, 0.55, 0.55, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{background: CREAM}}>
			<Sequence durationInFrames={INTRO}>
				<Intro hook={p.hook} pose={p.pose} />
			</Sequence>
			<Sequence from={INTRO} durationInFrames={main}>
				<Walk {...p} />
			</Sequence>
			<Sequence from={INTRO + main}>
				<Outro url={p.url} />
			</Sequence>
			<Audio src={staticFile('walk/music.mp3')} startFrom={Math.round(3.32 * FPS)} volume={music} />
		</AbsoluteFill>
	);
};

// Camera rects and caption times were read off frame grids of each recording (clips-x/<name>/keys.png).
export const WALKS: Record<string, WalkProps> = {
	premortem: {
		clip: 'premortem',
		from: 0.3,
		to: 15.5,
		hook: 'See what agents will see, before you launch.',
		pose: 'review',
		url: 'reinkeep.xyz/premortem',
		keys: [
			{t: 0.3, r: {x: 0, y: 40, w: 1264}},
			{t: 1.4, r: {x: 80, y: 380, w: 800}},
			{t: 2.4, r: {x: 80, y: 380, w: 800}},
			{t: 3.0, r: {x: 100, y: 230, w: 980}},
			{t: 5.0, r: {x: 100, y: 230, w: 980}},
			{t: 6.0, r: {x: 40, y: 180, w: 1100}},
			{t: 7.4, r: {x: 80, y: 70, w: 1100}},
			{t: 10.5, r: {x: 80, y: 70, w: 1100}},
			{t: 12.0, r: {x: 60, y: 300, w: 900}},
		],
		captions: [
			{t: 0, text: 'Name your token'},
			{t: 2.6, text: 'Tick what the contract can do'},
			{t: 5.2, text: 'Run the pre-mortem'},
			{t: 7.4, text: 'Mint on, owner live: agents would refuse it'},
			{t: 11.6, text: 'Every risk comes with its fix'},
		],
	},
	autopsy: {
		clip: 'autopsy',
		from: 0.3,
		to: 9.2,
		hook: 'What happened to that token after day one?',
		pose: 'review',
		url: 'reinkeep.xyz/autopsy',
		keys: [
			{t: 0.3, r: {x: 0, y: 40, w: 1264}},
			{t: 1.2, r: {x: 80, y: 380, w: 800}},
			{t: 3.3, r: {x: 80, y: 380, w: 800}},
			{t: 4.3, r: {x: 60, y: 60, w: 1000}},
			{t: 5.6, r: {x: 60, y: 60, w: 1000}},
			{t: 7.0, r: {x: 80, y: 240, w: 960}},
		],
		captions: [
			{t: 0, text: 'Paste a token address'},
			{t: 2.2, text: 'Look back one day'},
			{t: 3.9, text: 'CLOVER: $29,882 of liquidity, then $0'},
			{t: 6.4, text: '202 swaps on day one, 0 a day later'},
		],
	},
	radar: {
		clip: 'radar',
		from: 0.3,
		to: 14.2,
		hook: 'Spot a wave of copies early.',
		pose: 'hello',
		url: 'reinkeep.xyz/radar',
		keys: [
			{t: 0.3, r: {x: 0, y: 40, w: 1264}},
			{t: 2.4, r: {x: 0, y: 40, w: 1264}},
			{t: 3.6, r: {x: 40, y: 20, w: 1200}},
			{t: 8.8, r: {x: 40, y: 20, w: 1200}},
			{t: 10.4, r: {x: 100, y: 30, w: 1000}},
		],
		captions: [
			{t: 0, text: 'Tickers reused by new tokens, last 48 hours'},
			{t: 3.4, text: 'One circle per ticker, sized by copies'},
			{t: 9.6, text: 'MAX: 64 new tokens in 48 hours'},
		],
	},
};
