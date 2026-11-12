import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Keeper} from './keeper-mark';
import {Stage} from './render-stage';

// 3D X avatar (2026-11-12). The user's X header is a 3D brass ring with a strap; the flat avatar did not match
// and "wasn't interesting", so the avatar is now the same 3D mark (keeper-mark.tsx), turned a little so the
// strap shows depth. The 3D render sits on black and is laid over the ground with `screen`, so black drops out.
// Variant "plain": black + warm glow. Variant "grid": adds a faint tech grid and a thin brass orbit line.

const GROUND = '#07070A';

const Ground: React.FC<{grid: boolean}> = ({grid}) => (
	<AbsoluteFill style={{backgroundColor: GROUND}}>
		<AbsoluteFill style={{background: 'radial-gradient(circle at 50% 50%, rgba(214,160,70,.22) 0%, rgba(214,160,70,.06) 38%, transparent 62%)'}} />
		{grid && (
			<>
				<AbsoluteFill
					style={{
						backgroundImage:
							'linear-gradient(rgba(230,190,120,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(230,190,120,.07) 1px, transparent 1px)',
						backgroundSize: '40px 40px',
						backgroundPosition: '20px 20px',
						WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 20%, transparent 70%)',
					}}
				/>
				<svg viewBox="0 0 400 400" width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
					<ellipse cx={200} cy={200} rx={168} ry={168} fill="none" stroke="rgba(226,178,90,.55)" strokeWidth={1.4} />
					<circle cx={200} cy={32} r={3} fill="#F2C76E" />
				</svg>
			</>
		)}
	</AbsoluteFill>
);

export const XAvatar3D: React.FC<{grid: boolean}> = ({grid}) => (
	<AbsoluteFill>
		<Ground grid={grid} />
		<AbsoluteFill style={{mixBlendMode: 'screen'}}>
			<Stage camZ={7.6}>
				<Keeper position={[-0.12, 0.08, 0]} rotation={[0.28, -0.42, -0.08]} scale={0.9} />
			</Stage>
		</AbsoluteFill>
	</AbsoluteFill>
);

// "Wow" variant (user: no circle line, add effects). All effects are light, not objects: a hot backlight behind
// the ring, a blurred copy of the render for bloom, a long horizontal lens streak through the ring's top
// highlight, two star glints on the brightest edges, and a few warm dust specks. Positions are fixed numbers,
// so every render is identical.
const SPECKS: [number, number, number, number][] = [
	[118, 214, 2.2, 0.55], [664, 168, 1.6, 0.45], [702, 560, 2.4, 0.5], [180, 610, 1.8, 0.4], [560, 690, 1.4, 0.35],
	[96, 420, 1.2, 0.3], [610, 92, 1.3, 0.35], [742, 352, 1.5, 0.4], [300, 724, 1.6, 0.35], [430, 70, 1.1, 0.3],
];

const Glint: React.FC<{x: number; y: number; size: number; opacity?: number}> = ({x, y, size, opacity = 1}) => (
	<svg width={size} height={size} viewBox="-50 -50 100 100" style={{position: 'absolute', left: x - size / 2, top: y - size / 2, opacity, mixBlendMode: 'screen'}}>
		<defs>
			<radialGradient id="gcore">
				<stop offset="0" stopColor="#FFFFFF" />
				<stop offset="0.25" stopColor="#FFE9B8" stopOpacity="0.9" />
				<stop offset="1" stopColor="#FFB940" stopOpacity="0" />
			</radialGradient>
		</defs>
		<circle r={18} fill="url(#gcore)" />
		<path d="M0,-50 L3,-3 L50,0 L3,3 L0,50 L-3,3 L-50,0 L-3,-3 Z" fill="#FFF3D6" opacity={0.95} />
		<path d="M0,-50 L3,-3 L50,0 L3,3 L0,50 L-3,3 L-50,0 L-3,-3 Z" fill="#FFF3D6" opacity={0.45} transform="rotate(45) scale(0.45)" />
	</svg>
);

export const XAvatar3DWow: React.FC = () => {
	const mark = <Keeper position={[-0.05, -0.11, 0]} rotation={[0.28, -0.42, -0.08]} scale={0.9} />;
	return (
		<AbsoluteFill style={{backgroundColor: GROUND, overflow: 'hidden'}}>
			{/* backlight: a hot core behind the ring's hole, fading to dark amber */}
			<AbsoluteFill style={{background: 'radial-gradient(circle at 44% 49%, rgba(255,196,96,.42) 0%, rgba(224,140,40,.18) 22%, rgba(150,80,20,.06) 45%, transparent 66%)'}} />
			{/* faint vertical light shafts from above */}
			<AbsoluteFill style={{background: 'conic-gradient(from 180deg at 44% -10%, transparent 0deg, rgba(255,200,110,.07) 8deg, transparent 16deg, rgba(255,200,110,.05) 26deg, transparent 34deg)', mixBlendMode: 'screen'}} />
			{/* bloom: the same render, blurred, under the sharp one */}
			<AbsoluteFill style={{mixBlendMode: 'screen', filter: 'blur(26px) saturate(1.4)', opacity: 0.85}}>
				<Stage camZ={7.6}>{mark}</Stage>
			</AbsoluteFill>
			<AbsoluteFill style={{mixBlendMode: 'screen'}}>
				<Stage camZ={7.6}>{mark}</Stage>
			</AbsoluteFill>
			{/* lens streak through the top highlight */}
			<div style={{position: 'absolute', left: -40, right: -40, top: 271, height: 3, background: 'linear-gradient(90deg, transparent, rgba(255,190,90,.15) 20%, rgba(255,236,190,.95) 44%, rgba(255,190,90,.15) 70%, transparent)', filter: 'blur(1.2px)', mixBlendMode: 'screen'}} />
			<div style={{position: 'absolute', left: 60, right: 60, top: 260, height: 24, background: 'linear-gradient(90deg, transparent, rgba(255,170,60,.18) 44%, transparent)', filter: 'blur(8px)', mixBlendMode: 'screen'}} />
			<Glint x={366} y={272} size={150} />
			<Glint x={676} y={442} size={84} opacity={0.8} />
			{SPECKS.map(([x, y, r, o], i) => (
				<div key={i} style={{position: 'absolute', left: x, top: y, width: r * 2, height: r * 2, borderRadius: '50%', background: '#FFD58A', opacity: o, boxShadow: `0 0 ${r * 4}px rgba(255,190,90,.8)`}} />
			))}
			{/* vignette keeps the round crop's edge dark */}
			<AbsoluteFill style={{background: 'radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,.55) 78%)'}} />
		</AbsoluteFill>
	);
};
