import React from 'react';
import {AbsoluteFill} from 'remotion';
import {GOLD, GOLD_HI, INK, STRAP} from './keep-mascot';

// Flat stickers that float around the mascot on the Reinkeep site. Each is a 300x300 still,
// transparent background. Colours come from one bright flat palette shared with the mascot.
export const C = {
	gold: GOLD,
	blue: '#47B4FF',
	blueLo: '#2C8FE0',
	green: '#22C55E',
	greenLo: '#16A34A',
	red: '#FF5A3C',
	orange: '#FF9F1C',
	pink: '#FF7AB6',
	paper: '#FFFFFF',
	line: '#E7E3DA',
	ink: INK,
};

const Eyes: React.FC<{x: number; y: number; gap?: number}> = ({x, y, gap = 30}) => (
	<g>
		<ellipse cx={x - gap / 2} cy={y} rx={6} ry={9} fill={INK} />
		<ellipse cx={x + gap / 2} cy={y} rx={6} ry={9} fill={INK} />
	</g>
);

const art: Record<string, React.ReactNode> = {
	// USDG coin: the token the gate checks payments in
	coin: (
		<g>
			<circle cx={150} cy={158} r={96} fill={C.greenLo} />
			<circle cx={150} cy={150} r={96} fill={C.green} />
			<circle cx={150} cy={150} r={72} fill="none" stroke="#7BE3A3" strokeWidth={8} />
			<text x={150} y={182} textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontWeight={800} fontSize={92} fill="#fff">
				$
			</text>
		</g>
	),
	// receipt with a torn bottom edge
	receipt: (
		<g transform="rotate(-6 150 150)">
			<path d="M84 40 h132 v196 l-16 14 -17 -14 -16 14 -17 -14 -16 14 -17 -14 -16 14 -17 -14 z" fill={C.paper} stroke={C.line} strokeWidth={4} />
			<rect x={104} y={70} width={92} height={12} rx={6} fill={C.ink} />
			<rect x={104} y={100} width={70} height={10} rx={5} fill={C.line} />
			<rect x={104} y={124} width={84} height={10} rx={5} fill={C.line} />
			<rect x={104} y={148} width={58} height={10} rx={5} fill={C.line} />
			<rect x={104} y={184} width={92} height={22} rx={6} fill={C.green} />
		</g>
	),
	check: (
		<g>
			<path d="M150 46 a104 104 0 1 1 -74 177 l-34 14 14 -34 a104 104 0 0 1 94 -157 z" fill={C.green} />
			<path d="M104 152 l32 32 64 -68" stroke="#fff" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" fill="none" />
		</g>
	),
	question: (
		<g>
			{/* the check bubble mirrored, so the tail points the other way */}
			<path transform="translate(300 0) scale(-1 1)" d="M150 46 a104 104 0 1 1 -74 177 l-34 14 14 -34 a104 104 0 0 1 94 -157 z" fill={C.orange} />
			<path d="M118 120 a32 32 0 1 1 46 29 c-12 6 -14 14 -14 26" stroke="#fff" strokeWidth={20} strokeLinecap="round" fill="none" />
			<circle cx={150} cy={212} r={12} fill="#fff" />
		</g>
	),
	cross: (
		<g>
			<path d="M108 40 h84 l58 58 v84 l-58 58 h-84 l-58 -58 v-84 z" fill={C.red} />
			<path d="M114 106 l72 72 M186 106 l-72 72" stroke="#fff" strokeWidth={24} strokeLinecap="round" />
		</g>
	),
	lock: (
		<g>
			<path d="M104 136 v-30 a46 46 0 0 1 92 0 v30" stroke={C.blueLo} strokeWidth={24} fill="none" />
			<rect x={70} y={130} width={160} height={124} rx={30} fill={C.blue} />
			<Eyes x={150} y={180} />
			<path d="M136 208 q14 12 28 0" stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
		</g>
	),
	star: <path d="M150 34 l32 72 78 8 -59 52 17 77 -68 -40 -68 40 17 -77 -59 -52 78 -8 z" fill={C.gold} />,
	sparkle: (
		<g fill={C.blue}>
			<path d="M150 40 C 160 120, 180 140, 260 150 C 180 160, 160 180, 150 260 C 140 180, 120 160, 40 150 C 120 140, 140 120, 150 40 z" />
		</g>
	),
	horseshoe: (
		<g transform="rotate(14 150 150)">
			<path d="M84 72 v86 a66 66 0 0 0 132 0 v-86" stroke={STRAP} strokeWidth={46} strokeLinecap="round" fill="none" />
			<path d="M84 72 v86 a66 66 0 0 0 132 0 v-86" stroke={GOLD_HI} strokeWidth={14} strokeLinecap="round" fill="none" strokeDasharray="2 26" />
		</g>
	),
	heart: <path d="M150 248 C 40 170, 40 70, 104 62 C 132 58, 146 78, 150 92 C 154 78, 168 58, 196 62 C 260 70, 260 170, 150 248 z" fill={C.pink} />,
	cloud: (
		<g>
			<path d="M78 210 a52 52 0 0 1 8 -102 a66 66 0 0 1 124 -6 a54 54 0 0 1 14 108 z" fill={C.blue} />
			<Eyes x={152} y={162} />
		</g>
	),
	bolt: <path d="M168 30 L 78 168 h62 l-26 102 L 222 120 h-64 z" fill={C.orange} />,
	shield: (
		<g>
			<path d="M150 34 l100 36 v70 c0 70 -44 112 -100 132 c-56 -20 -100 -62 -100 -132 v-70 z" fill={C.green} />
			<path d="M108 154 l30 30 56 -60" stroke="#fff" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" fill="none" />
		</g>
	),
	dots: (
		<g>
			<rect x={44} y={92} width={212} height={116} rx={58} fill={C.paper} stroke={C.line} strokeWidth={6} />
			<circle cx={104} cy={150} r={16} fill={C.green} />
			<circle cx={150} cy={150} r={16} fill={C.orange} />
			<circle cx={196} cy={150} r={16} fill={C.red} />
		</g>
	),
	ring: (
		<g>
			<circle cx={130} cy={150} r={78} stroke={GOLD} strokeWidth={34} fill="none" />
			<rect x={176} y={122} width={92} height={56} rx={18} fill={STRAP} />
		</g>
	),
};

export const STICKERS = Object.keys(art);

export const Sticker: React.FC<{name: string}> = ({name}) => (
	<AbsoluteFill>
		<svg viewBox="0 0 300 300" width="100%" height="100%">
			{art[name]}
		</svg>
	</AbsoluteFill>
);
