import React from 'react';
import {AbsoluteFill} from 'remotion';
import {INK, KeepMascot} from './keep-mascot';
import {Sticker} from './family-stickers';
import {PAGE_ART} from './page-art';
import {useInter} from './x-profile-v3';

// Link preview card (1200x630) for one page of reinkeep.xyz, in the site's own look: cream ground, ink Inter,
// Keep and the stickers. The page's hero line on the left, its illustration on the right. X crops nothing at
// 1.91:1, but small previews shrink it to ~500 px wide, so the line is big and there is little else.
// Props come from site-family/src/lib/site-pages.ts via render-og.mjs.

export type OgCardProps = {card: string; art: string};

const SANS = '"Inter Site", system-ui, sans-serif';

const Art: React.FC<{art: string}> = ({art}) => {
	if (art === 'home') {
		return (
			<>
				<div style={{position: 'absolute', left: 110, top: 120, width: 400, height: 400}}>
					<KeepMascot pose="hello" />
				</div>
				{([['coin', 50, 70, 110, -10], ['receipt', 390, 60, 120, 8], ['check', 430, 330, 100, -6], ['heart', 30, 380, 80, 8], ['sparkle', 360, 230, 60, 0]] as const).map(([name, x, y, s, r]) => (
					<div key={name} style={{position: 'absolute', left: x, top: y, width: s, height: s, transform: `rotate(${r}deg)`}}>
						<Sticker name={name} />
					</div>
				))}
			</>
		);
	}
	const Page = PAGE_ART[art];
	// page art is 1200x900; shown at 0.5 -> 600x450, inside x 600..1200 so it never reaches the text
	return (
		<div style={{position: 'absolute', left: 0, top: 110, width: 1200, height: 900, transform: 'scale(0.5)', transformOrigin: '0 0'}}>
			<Page />
		</div>
	);
};

export const OgCard: React.FC<OgCardProps> = ({card, art}) => {
	useInter();
	const long = card.length > 34;
	return (
		<AbsoluteFill style={{backgroundColor: '#F7F6F3', fontFamily: SANS, color: INK}}>
			<div style={{position: 'absolute', left: 600, top: 0, width: 600, height: 630, overflow: 'hidden'}}>
				<Art art={art} />
			</div>
			<div style={{position: 'absolute', left: 72, top: 64, display: 'flex', alignItems: 'center', gap: 14}}>
				<div style={{position: 'relative', width: 72, height: 72, margin: '-13px -14px -13px -16px'}}>
					<KeepMascot pose="calm" bare />
				</div>
				<span style={{fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em'}}>Reinkeep</span>
			</div>
			<div style={{position: 'absolute', left: 72, top: 0, bottom: 0, width: 500, display: 'flex', alignItems: 'center'}}>
				<p style={{margin: 0, fontSize: long ? 52 : 62, fontWeight: 650, lineHeight: 1.04, letterSpacing: '-0.035em', whiteSpace: 'pre-line'}}>{card}</p>
			</div>
			<div style={{position: 'absolute', left: 72, bottom: 60, fontSize: 26, color: 'rgba(26,26,26,.55)'}}>reinkeep.xyz</div>
		</AbsoluteFill>
	);
};
