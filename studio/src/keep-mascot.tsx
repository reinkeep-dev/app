import React from 'react';
import {AbsoluteFill} from 'remotion';

// "Keep", the Reinkeep mascot: the gold ring from the logo as a body, a face in the ring's hole,
// the leather strap tab on its right side, and thin ink limbs. Flat colour, no outlines, like a sticker.
// Every pose is a still on a transparent background; the site floats them with CSS.

export const INK = '#1A1A1A';
export const GOLD = '#F5B731';
export const GOLD_HI = '#FFD56B';
export const GOLD_LO = '#D99A1E';
export const STRAP = '#B9772A';
export const CREAM = '#FFF5DC';
export const BLUSH = '#FF8FA3';

export type Pose = 'hello' | 'allow' | 'review' | 'block' | 'calm';

const limb = {stroke: INK, strokeWidth: 16, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none'};

const Face: React.FC<{pose: Pose}> = ({pose}) => {
	const eyes =
		pose === 'calm' ? (
			<>
				<path d="M258 272 q14 12 28 0" {...limb} strokeWidth={8} />
				<path d="M314 272 q14 12 28 0" {...limb} strokeWidth={8} />
			</>
		) : pose === 'review' ? (
			<>
				<ellipse cx={278} cy={266} rx={9} ry={13} fill={INK} />
				<ellipse cx={330} cy={266} rx={9} ry={13} fill={INK} />
				<path d="M262 240 l28 -6" {...limb} strokeWidth={7} />
			</>
		) : pose === 'block' ? (
			<>
				<ellipse cx={272} cy={272} rx={9} ry={11} fill={INK} />
				<ellipse cx={328} cy={272} rx={9} ry={11} fill={INK} />
				<path d="M256 246 l30 10" {...limb} strokeWidth={7} />
				<path d="M344 246 l-30 10" {...limb} strokeWidth={7} />
			</>
		) : (
			<>
				<ellipse cx={272} cy={268} rx={10} ry={14} fill={INK} />
				<ellipse cx={328} cy={268} rx={10} ry={14} fill={INK} />
				<circle cx={275} cy={263} r={3.5} fill="#fff" />
				<circle cx={331} cy={263} r={3.5} fill="#fff" />
			</>
		);
	const mouth =
		pose === 'allow' ? (
			<path d="M270 300 q30 34 60 0 z" fill={INK} />
		) : pose === 'review' ? (
			<ellipse cx={304} cy={308} rx={8} ry={9} fill={INK} />
		) : pose === 'block' ? (
			<path d="M280 312 h40" {...limb} strokeWidth={8} />
		) : (
			<path d="M278 302 q22 20 44 0" {...limb} strokeWidth={8} />
		);
	return (
		<g>
			<circle cx={300} cy={282} r={84} fill={CREAM} />
			{pose !== 'block' && (
				<>
					<circle cx={252} cy={300} r={11} fill={BLUSH} opacity={0.55} />
					<circle cx={348} cy={300} r={11} fill={BLUSH} opacity={0.55} />
				</>
			)}
			{eyes}
			{mouth}
		</g>
	);
};

// Arms per pose. The body ring is centred at (300, 282), outer radius 150.
const Arms: React.FC<{pose: Pose; front: boolean}> = ({pose, front}) => {
	if (pose === 'block' && front)
		return (
			<g>
				<path d="M178 330 C 230 380, 330 390, 410 336" {...limb} />
				<path d="M422 330 C 370 380, 270 390, 190 336" {...limb} />
			</g>
		);
	if (front) return null;
	switch (pose) {
		case 'hello':
			return (
				<g>
					<path d="M160 300 C 110 270, 100 210, 116 160" {...limb} />
					<path d="M104 150 l-14 -18 M118 146 l0 -24 M132 150 l12 -18" {...limb} strokeWidth={10} />
					<path d="M444 320 C 480 350, 500 380, 494 410" {...limb} />
				</g>
			);
		case 'allow':
			return (
				<g>
					<path d="M162 270 C 120 230, 110 180, 128 130" {...limb} />
					<path d="M438 270 C 480 230, 490 180, 472 130" {...limb} />
				</g>
			);
		case 'review':
			return (
				<g>
					<path d="M440 250 C 490 210, 470 150, 410 150" {...limb} />
					<path d="M160 320 C 120 350, 104 384, 112 412" {...limb} />
				</g>
			);
		case 'calm':
			return (
				<g>
					<path d="M160 320 C 120 350, 108 380, 140 404" {...limb} />
					<path d="M440 320 C 480 350, 492 380, 460 404" {...limb} />
					<circle cx={140} cy={404} r={10} fill={INK} />
					<circle cx={460} cy={404} r={10} fill={INK} />
				</g>
			);
		default:
			return null;
	}
};

const Legs: React.FC<{pose: Pose}> = ({pose}) =>
	pose === 'calm' ? (
		<g>
			<path d="M250 426 C 210 470, 330 486, 360 452" {...limb} />
			<path d="M350 426 C 390 470, 270 486, 240 452" {...limb} />
		</g>
	) : (
		<g>
			<path d="M262 426 L 252 508" {...limb} />
			<path d="M338 426 L 348 508" {...limb} />
			<ellipse cx={240} cy={514} rx={24} ry={11} fill={INK} />
			<ellipse cx={360} cy={514} rx={24} ry={11} fill={INK} />
		</g>
	);

// `bare` drops the limbs and floor shadow: just the ring, strap and face (the X avatar crops in tight,
// and stray limb ends at the circle's edge read as mistakes). Defaults to the full character.
export const KeepMascot: React.FC<{pose: Pose; bare?: boolean}> = ({pose, bare = false}) => (
	<AbsoluteFill>
		<svg viewBox="0 0 600 600" width="100%" height="100%">
			{!bare && (
				<>
					<ellipse cx={300} cy={548} rx={pose === 'calm' ? 150 : 120} ry={14} fill={INK} opacity={0.08} />
					<Legs pose={pose} />
					<Arms pose={pose} front={false} />
				</>
			)}
			{/* strap tab, as in the logo */}
			<rect x={404} y={244} width={150} height={76} rx={24} fill={STRAP} />
			<rect x={420} y={258} width={118} height={12} rx={6} fill="#D9954A" />
			{/* ring body with a soft top-left highlight */}
			<circle cx={300} cy={282} r={150} fill={GOLD} />
			<path d="M190 210 A 132 132 0 0 1 300 150" stroke={GOLD_HI} strokeWidth={22} strokeLinecap="round" fill="none" />
			<path d="M420 340 A 132 132 0 0 1 340 410" stroke={GOLD_LO} strokeWidth={18} strokeLinecap="round" fill="none" opacity={0.7} />
			<Face pose={pose} />
			{!bare && <Arms pose={pose} front />}
		</svg>
	</AbsoluteFill>
);
