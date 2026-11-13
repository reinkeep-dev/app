import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, staticFile} from 'remotion';

// X profile art v3 (2026-11-12). User asked for a header + logo that looks grown-up, "not like a kid's thing".
// Three directions to choose from, each an avatar (400x400, shown as a circle) and a header (1500x500).
// X covers the header's bottom-left with the avatar and crops top/bottom on phones, so content sits in the
// middle band and away from x < 330 at the bottom.

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const SANS = '"Inter Site", system-ui, sans-serif';

export function useInter() {
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

// The mark, redrawn clean from site/brand/logo.webp: a ring with a strap tab entering its right side.
// The strap is cut out of the ring with a gap in the ground colour, so it reads as two pieces, not one blob.
const Mark: React.FC<{size: number; ring: string; strap: string; ground: string; outer?: string}> = ({size, ring, strap, ground, outer}) => (
	<svg viewBox="0 0 200 200" width={size} height={size}>
		{outer && <circle cx={100} cy={100} r={94} fill="none" stroke={outer} strokeWidth={2.2} />}
		<circle cx={80} cy={100} r={44} fill="none" stroke={ring} strokeWidth={13} />
		<rect x={98} y={84} width={70} height={32} rx={6} fill={ground} stroke={ground} strokeWidth={5} />
		<rect x={98} y={84} width={70} height={32} rx={6} fill={strap} />
		<rect x={98} y={84} width={9} height={32} fill={strap} />
	</svg>
);

/* ---------- A. Vault: black and brass, the mark as a big object ---------- */

const A = {ground: '#0A0A0B', gold: '#D8AE52', text: '#F2EFE8'};

export const XAvatarVault: React.FC = () => (
	<AbsoluteFill style={{background: `radial-gradient(circle at 50% 42%, #1c1913 0%, ${A.ground} 62%)`, alignItems: 'center', justifyContent: 'center'}}>
		<Mark size={330} ring={A.gold} strap={A.gold} ground="#121110" />
	</AbsoluteFill>
);

export const XHeaderVault: React.FC = () => {
	useInter();
	return (
		<AbsoluteFill style={{backgroundColor: A.ground, overflow: 'hidden'}}>
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 60% 90% at 78% 50%, rgba(216,174,82,.16), transparent 70%)'}} />
			{/* the mark, cropped by the right edge */}
			<div style={{position: 'absolute', left: 930, top: -170, opacity: 0.95}}>
				<Mark size={840} ring={A.gold} strap={A.gold} ground={A.ground} />
			</div>
			<div style={{position: 'absolute', left: 120, top: 128, fontFamily: SANS, color: A.text}}>
				<p style={{margin: 0, fontWeight: 600, fontSize: 70, lineHeight: 1.02, letterSpacing: '-0.04em'}}>
					Your agent pays.
					<br />
					<span style={{color: A.gold}}>You hold the reins.</span>
				</p>
				<p style={{margin: '26px 0 0', fontFamily: MONO, fontSize: 20, color: 'rgba(242,239,232,.55)'}}>pre-trade gate for AI agents on Robinhood Chain</p>
			</div>
		</AbsoluteFill>
	);
};

/* ---------- B. Slip: paper and ink, a real payment slip stamped BLOCK ---------- */

const B = {ground: '#F3F0E8', ink: '#141414', gold: '#C9982F', red: '#D23B1F'};

export const XAvatarSlip: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: B.ground, alignItems: 'center', justifyContent: 'center'}}>
		<Mark size={330} ring={B.ink} strap={B.gold} ground={B.ground} />
	</AbsoluteFill>
);

const SLIP_ROWS: [string, string][] = [
	['pay to', '0x7f3a…c91e  (never seen)'],
	['amount', '0.50 USDG'],
	['network', 'Robinhood Chain'],
	['rule', 'new_recipient'],
];

export const XHeaderSlip: React.FC = () => {
	useInter();
	return (
		<AbsoluteFill style={{backgroundColor: B.ground}}>
			<div style={{position: 'absolute', left: 120, top: 128, fontFamily: SANS, color: B.ink}}>
				<p style={{margin: 0, fontWeight: 600, fontSize: 66, lineHeight: 1.03, letterSpacing: '-0.04em'}}>
					Every agent payment
					<br />
					gets checked first.
				</p>
				<p style={{margin: '24px 0 0', fontFamily: MONO, fontSize: 20, color: 'rgba(20,20,20,.55)'}}>reinkeep · pre-trade gate · Robinhood Chain</p>
			</div>
			{/* the slip: a sample request, labelled as one; rule code and verdict are the engine's real words */}
			<div style={{position: 'absolute', left: 900, top: 64, width: 480, height: 372, backgroundColor: '#FFFFFF', boxShadow: '0 1px 0 rgba(0,0,0,.06), 0 30px 60px -30px rgba(20,20,20,.35)', transform: 'rotate(-2deg)', fontFamily: MONO, color: B.ink}}>
				<div style={{padding: '26px 30px 14px', fontSize: 15, letterSpacing: '0.02em', color: 'rgba(20,20,20,.5)', borderBottom: '1px dashed rgba(20,20,20,.25)'}}>payment request · sample</div>
				<div style={{padding: '12px 30px'}}>
					{SLIP_ROWS.map(([k, v]) => (
						<div key={k} style={{display: 'flex', fontSize: 20, lineHeight: '50px', borderBottom: '1px solid rgba(20,20,20,.08)'}}>
							<span style={{width: 120, color: 'rgba(20,20,20,.5)'}}>{k}</span>
							<span>{v}</span>
						</div>
					))}
				</div>
				<div style={{position: 'absolute', right: 34, bottom: 30, padding: '6px 18px', border: `4px solid ${B.red}`, color: B.red, fontFamily: SANS, fontWeight: 800, fontSize: 52, letterSpacing: '0.02em', transform: 'rotate(-8deg)', opacity: 0.92}}>
					BLOCK
				</div>
			</div>
		</AbsoluteFill>
	);
};

/* ---------- C. Verdict: dark, the three answers as giant type, one lit ---------- */

const C = {ground: '#0E0F12', gold: '#E6B43C', text: '#F4F4F2', red: '#F0502E'};

export const XAvatarVerdict: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center'}}>
		<Mark size={330} ring={C.text} strap={C.gold} ground={C.ground} />
	</AbsoluteFill>
);

export const XHeaderVerdict: React.FC = () => {
	useInter();
	const word = (w: string, lit: boolean) => (
		<div
			style={{
				fontFamily: SANS,
				fontWeight: 800,
				fontSize: 132,
				lineHeight: 0.98,
				letterSpacing: '-0.045em',
				color: lit ? C.red : 'rgba(244,244,242,.09)',
			}}
		>
			{w}
		</div>
	);
	return (
		<AbsoluteFill style={{backgroundColor: C.ground, overflow: 'hidden'}}>
			<div style={{position: 'absolute', right: 110, top: 48, textAlign: 'right'}}>
				{word('ALLOW', false)}
				{word('REVIEW', false)}
				{word('BLOCK', true)}
			</div>
			<div style={{position: 'absolute', left: 120, top: 150, fontFamily: SANS, color: C.text, width: 720}}>
				<p style={{margin: 0, fontWeight: 600, fontSize: 52, lineHeight: 1.06, letterSpacing: '-0.035em'}}>Before your agent pays,<br />Reinkeep answers.</p>
				<p style={{margin: '22px 0 0', fontFamily: MONO, fontSize: 19, color: 'rgba(244,244,242,.5)'}}>new_recipient · over_payment_cap · duplicate_payment</p>
			</div>
		</AbsoluteFill>
	);
};
