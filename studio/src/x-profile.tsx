import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, staticFile} from 'remotion';

// X (Twitter) profile art for @reinkeepgate. 2026-11-11 v2: the user found the mascot version "too cute,
// like a kid's thing" and asked for more tech. So: no face, no stickers. The logo's own geometry (a ring
// holding a strap), a faint dot grid, and a terminal-style decision log with the real rule codes.
// Avatar 400x400 (shown as a circle), header 1500x500.

const INK = '#111318';
const PAPER = '#FFFFFF';
const GOLD = '#F5B731';
const ALLOW = '#16A34A';
const REVIEW = '#E58A0C';
const BLOCK = '#E5482B';
const MONO = 'ui-monospace, Menlo, monospace';

// The site's own Inter file (studio/public/fonts), loaded before the frame is captured; a failed load fails the render.
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

const DotGrid: React.FC<{color: string; gap: number; r: number}> = ({color, gap, r}) => (
	<AbsoluteFill style={{backgroundImage: `radial-gradient(circle, ${color} ${r}px, transparent ${r + 0.6}px)`, backgroundSize: `${gap}px ${gap}px`}} />
);

// The logo mark: ring + strap, flat geometry (same proportions as site/brand/logo.webp).
const Mark: React.FC<{size: number; ring: string; strap: string}> = ({size, ring, strap}) => (
	<svg viewBox="0 0 200 140" width={size} height={size * 0.7}>
		<circle cx={64} cy={70} r={50} fill="none" stroke={ring} strokeWidth={17} />
		<rect x={98} y={50} width={92} height={40} rx={10} fill={strap} />
	</svg>
);

export const XAvatar: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: INK}}>
		<DotGrid color="rgba(255,255,255,.07)" gap={22} r={1.4} />
		{/* centred on the circle; the strap stays inside X's round crop */}
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingLeft: 8}}>
			<Mark size={270} ring={PAPER} strap={GOLD} />
		</AbsoluteFill>
	</AbsoluteFill>
);

const LOG: {word: string; color: string; code: string}[] = [
	{word: 'ALLOW', color: ALLOW, code: 'no rule fired'},
	{word: 'REVIEW', color: REVIEW, code: 'new_recipient'},
	{word: 'BLOCK', color: BLOCK, code: 'over_payment_cap'},
	{word: 'BLOCK', color: BLOCK, code: 'duplicate_payment'},
	{word: 'ALLOW', color: ALLOW, code: 'no rule fired'},
];

export const XHeader: React.FC = () => {
	useInter();
	return (
		<AbsoluteFill style={{backgroundColor: PAPER}}>
			<DotGrid color="rgba(17,19,24,.09)" gap={26} r={1.3} />
			{/* left: headline, kept in the top half because X's avatar covers the bottom-left corner */}
			<div style={{position: 'absolute', left: 110, top: 96, fontFamily: '"Inter Site", sans-serif', color: INK}}>
				<p style={{margin: 0, fontWeight: 650, fontSize: 66, lineHeight: 1.04, letterSpacing: '-0.035em'}}>
					Your agent pays.
					<br />
					You hold the reins.
				</p>
				<p style={{margin: '20px 0 0', fontFamily: MONO, fontSize: 21, color: 'rgba(17,19,24,.6)'}}>
					pre-trade gate for AI agents · Robinhood Chain
				</p>
			</div>
			{/* right: a terminal-style decision log; illustrative rows, real rule codes and verdict words */}
			<div style={{position: 'absolute', left: 860, top: 70, width: 540, height: 340, borderRadius: 16, backgroundColor: INK, boxShadow: '0 24px 50px -24px rgba(17,19,24,.55)', overflow: 'hidden'}}>
				<div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,.08)'}}>
					<Mark size={34} ring={PAPER} strap={GOLD} />
					<span style={{fontFamily: MONO, fontSize: 16, color: 'rgba(255,255,255,.45)'}}>reinkeep · decisions (sample)</span>
				</div>
				<div style={{padding: '18px 26px', fontFamily: MONO, fontSize: 22, lineHeight: '46px'}}>
					{LOG.map((row, i) => (
						<div key={i} style={{display: 'flex', gap: 22}}>
							<span style={{width: 92, color: row.color, fontWeight: 700}}>{row.word}</span>
							<span style={{color: 'rgba(255,255,255,.82)'}}>{row.code}</span>
						</div>
					))}
				</div>
			</div>
		</AbsoluteFill>
	);
};
