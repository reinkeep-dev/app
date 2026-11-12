import React from 'react';
import {AbsoluteFill} from 'remotion';
import {GOLD, GOLD_HI, GOLD_LO, INK, KeepMascot, STRAP, type Pose} from './keep-mascot';

// Page illustrations (1200x900, transparent): Keep doing each page's job with a real product object.
// Same flat look as the mascot and stickers: no outlines on figures, solid colours, hairline card edges.
// Layers: back (scene coords) -> shadow+legs -> Keep (ring, face, strap) -> arms (Keep coords) -> front (scene coords).

const ALLOW = '#16A34A';
const REVIEW = '#E58A0C';
const BLOCK = '#E5482B';
const PAPER = '#FFFFFF';
const PANEL = '#F7F6F3';
const HAIR = '#E2DED5';
const GREY = '#D8D3C8';
const FONT = 'Inter, Arial, Helvetica, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

const limb = {stroke: INK, strokeWidth: 16, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none'};
const full = {position: 'absolute' as const, left: 0, top: 0, width: '100%', height: '100%'};

type StageProps = {pose: Pose; ox?: number; oy?: number; back?: React.ReactNode; arms: React.ReactNode; front?: React.ReactNode};

const Stage: React.FC<StageProps> = ({pose, ox = 40, oy = 190, back, arms, front}) => (
	<AbsoluteFill>
		<svg viewBox="0 0 1200 900" style={full}>
			<rect x={60} y={734} width={1080} height={6} rx={3} fill={HAIR} />
			{back}
			<g transform={`translate(${ox} ${oy})`}>
				<ellipse cx={300} cy={548} rx={120} ry={14} fill={INK} opacity={0.08} />
				<path d="M262 426 L 252 508" {...limb} />
				<path d="M338 426 L 348 508" {...limb} />
				<ellipse cx={240} cy={514} rx={24} ry={11} fill={INK} />
				<ellipse cx={360} cy={514} rx={24} ry={11} fill={INK} />
			</g>
		</svg>
		<div style={{position: 'absolute', left: ox, top: oy, width: 600, height: 600}}>
			<KeepMascot pose={pose} bare />
		</div>
		<svg viewBox="0 0 1200 900" style={full}>
			<g transform={`translate(${ox} ${oy})`}>{arms}</g>
			{front}
		</svg>
	</AbsoluteFill>
);

const Hand: React.FC<{x: number; y: number}> = ({x, y}) => <circle cx={x} cy={y} r={13} fill={INK} />;
const RestArm: React.FC<{left?: boolean}> = ({left = true}) =>
	left ? (
		<g>
			<path d="M160 330 C 120 360, 108 390, 120 420" {...limb} />
			<circle cx={120} cy={420} r={11} fill={INK} />
		</g>
	) : (
		<g>
			<path d="M440 330 C 480 360, 492 390, 480 420" {...limb} />
			<circle cx={480} cy={420} r={11} fill={INK} />
		</g>
	);

// the logo mark: gold ring with the strap tab
const RingMark: React.FC<{x: number; y: number; r: number}> = ({x, y, r}) => (
	<g>
		<rect x={x + r * 0.55} y={y - r * 0.28} width={r * 1.1} height={r * 0.56} rx={r * 0.2} fill={STRAP} />
		<circle cx={x} cy={y} r={r} fill={GOLD} />
		<circle cx={x} cy={y} r={r * 0.5} fill={PANEL} />
	</g>
);

const Chip: React.FC<{x: number; y: number; w?: number; h?: number; fill: string; label: string}> = ({x, y, w = 250, h = 56, fill, label}) => (
	<g>
		<rect x={x} y={y + 5} width={w} height={h} rx={h / 2} fill={INK} opacity={0.12} />
		<rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />
		<text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={32} letterSpacing={2} fill="#fff">
			{label}
		</text>
	</g>
);

const Card: React.FC<{x: number; y: number; w: number; h: number; r?: number}> = ({x, y, w, h, r = 24}) => (
	<g>
		<rect x={x + 10} y={y + 12} width={w} height={h} rx={r} fill={INK} opacity={0.08} />
		<rect x={x} y={y} width={w} height={h} rx={r} fill={PAPER} stroke={HAIR} strokeWidth={4} />
	</g>
);

const Coin: React.FC<{x: number; y: number; r: number}> = ({x, y, r}) => (
	<g>
		<circle cx={x} cy={y + r * 0.07} r={r} fill="#11803A" />
		<circle cx={x} cy={y} r={r} fill="#22C55E" />
		<circle cx={x} cy={y} r={r * 0.75} fill="none" stroke="#7BE3A3" strokeWidth={r * 0.085} />
		<text x={x} y={y + r * 0.34} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={r * 0.96} fill="#fff">
			$
		</text>
	</g>
);

const Bar: React.FC<{x: number; y: number; w: number; h?: number; fill?: string}> = ({x, y, w, h = 14, fill = GREY}) => (
	<rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />
);

// ---------- 1. gate ----------
export const PageGate: React.FC = () => {
	const hand = {x: 620, y: 540}; // scene coords (Keep offset 40,190)
	return (
		<Stage
			pose="hello"
			back={
				<g>
					{/* booth */}
					<rect x={930} y={410} width={150} height={325} rx={14} fill={PANEL} stroke={HAIR} strokeWidth={4} />
					<rect x={930} y={600} width={150} height={135} rx={14} fill={STRAP} />
					<rect x={950} y={620} width={110} height={12} rx={6} fill="#D9954A" />
					<rect x={956} y={450} width={98} height={86} rx={12} fill="#CFE8FF" />
					<rect x={906} y={376} width={198} height={40} rx={14} fill={INK} />
					{/* sign pole + verdict board */}
					<rect x={996} y={320} width={18} height={60} fill={INK} />
					<Card x={850} y={78} w={300} h={246} />
					<Chip x={875} y={103} fill={ALLOW} label="ALLOW" />
					<Chip x={875} y={177} fill={REVIEW} label="REVIEW" />
					<Chip x={875} y={251} fill={BLOCK} label="BLOCK" />
					{/* barrier arm, lifted */}
					<g transform="translate(930 474) rotate(32)">
						<rect x={-26} y={-16} width={70} height={32} rx={10} fill={INK} />
						<defs>
							<clipPath id="gate-arm">
								<rect x={-250} y={-17} width={250} height={34} rx={17} />
							</clipPath>
						</defs>
						<g clipPath="url(#gate-arm)">
							<rect x={-250} y={-17} width={250} height={34} fill={PAPER} />
							{[0, 1, 2, 3, 4].map((i) => (
								<rect key={i} x={-250 + i * 100} y={-17} width={50} height={34} fill={ALLOW} />
							))}
						</g>
					</g>
					<circle cx={930} cy={474} r={24} fill={GOLD} />
					<circle cx={930} cy={474} r={10} fill={GOLD_LO} />
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 490 385, 540 385, 580 350" {...limb} />
					<RestArm />
				</g>
			}
			front={
				<g>
					{/* payment slip with a stamped verdict */}
					<g transform={`rotate(8 ${hand.x} ${hand.y - 90})`}>
						<rect x={hand.x - 62 + 8} y={hand.y - 190 + 10} width={130} height={200} rx={12} fill={INK} opacity={0.1} />
						<rect x={hand.x - 62} y={hand.y - 190} width={130} height={200} rx={12} fill={PAPER} stroke={HAIR} strokeWidth={4} />
						<circle cx={hand.x - 28} cy={hand.y - 150} r={20} fill="#22C55E" />
						<text x={hand.x - 28} y={hand.y - 141} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={26} fill="#fff">$</text>
						<Bar x={hand.x + 2} y={hand.y - 160} w={50} h={10} />
						<Bar x={hand.x + 2} y={hand.y - 142} w={36} h={10} />
						<Bar x={hand.x - 44} y={hand.y - 104} w={96} h={10} />
						<g transform={`rotate(-14 ${hand.x} ${hand.y - 48})`}>
							<rect x={hand.x - 56} y={hand.y - 72} width={112} height={46} rx={8} fill="none" stroke={ALLOW} strokeWidth={5} />
							<text x={hand.x} y={hand.y - 39} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={27} letterSpacing={1} fill={ALLOW}>ALLOW</text>
						</g>
					</g>
					<Hand x={hand.x} y={hand.y} />
				</g>
			}
		/>
	);
};

// ---------- 2. check ----------
export const PageCheck: React.FC = () => {
	const lens = {x: 772, y: 486, r: 104};
	const rows: {ok: boolean; w: number}[] = [
		{ok: true, w: 120},
		{ok: true, w: 90},
		{ok: false, w: 110},
		{ok: true, w: 100},
	];
	return (
		<Stage
			pose="review"
			back={
				<g>
					{/* coin on a stand */}
					<path d="M676 622 h128 l26 113 h-180 z" fill={PANEL} stroke={HAIR} strokeWidth={4} />
					<Coin x={740} y={530} r={92} />
					{/* checklist card */}
					<Card x={900} y={140} w={260} h={450} />
					<RingMark x={950} y={196} r={22} />
					<Bar x={1010} y={190} w={110} h={14} fill={INK} />
					{rows.map((row, i) => {
						const y = 280 + i * 76;
						return (
							<g key={i}>
								<circle cx={950} cy={y} r={25} fill={row.ok ? ALLOW : BLOCK} />
								{row.ok ? (
									<path d={`M938 ${y} l9 9 l17 -19`} stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
								) : (
									<path d={`M940 ${y - 10} l20 20 M960 ${y - 10} l-20 20`} stroke="#fff" strokeWidth={7} strokeLinecap="round" fill="none" />
								)}
								<Bar x={994} y={y - 14} w={row.w + 30} h={12} />
								<Bar x={994} y={y + 6} w={row.w - 10} h={10} fill={HAIR} />
							</g>
						);
					})}
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 480 390, 520 410, 566 404" {...limb} />
					<RestArm />
				</g>
			}
			front={
				<g>
					{/* magnifying glass */}
					<line x1={lens.x - 74} y1={lens.y + 74} x2={606} y2={600} stroke={STRAP} strokeWidth={24} strokeLinecap="round" />
					<defs>
						<clipPath id="check-lens">
							<circle cx={lens.x} cy={lens.y} r={lens.r - 6} />
						</clipPath>
					</defs>
					<circle cx={lens.x} cy={lens.y} r={lens.r} fill="#E4F2FF" opacity={0.55} />
					<g clipPath="url(#check-lens)">
						<g transform={`translate(740 530) scale(1.3) translate(-740 -530)`}>
							<Coin x={740} y={530} r={92} />
						</g>
					</g>
					<circle cx={lens.x} cy={lens.y} r={lens.r} fill="none" stroke={INK} strokeWidth={14} />
					<path d={`M${lens.x - 70} ${lens.y - 30} A 78 78 0 0 1 ${lens.x - 30} ${lens.y - 70}`} stroke="#fff" strokeWidth={9} strokeLinecap="round" fill="none" opacity={0.85} />
					<Hand x={606} y={594} />
				</g>
			}
		/>
	);
};

// ---------- 3. docs ----------
export const PageDocs: React.FC = () => (
	<Stage
		pose="hello"
		back={
			<g>
				{/* cable from terminal to plug */}
				<path d="M985 560 C 985 470, 930 440, 930 350" stroke={INK} strokeWidth={10} strokeLinecap="round" fill="none" />
				{/* terminal card */}
				<rect x={610} y={116} width={540} height={250} rx={26} fill={INK} opacity={0.1} transform="translate(10 12)" />
				<rect x={610} y={116} width={540} height={250} rx={26} fill={INK} />
				<circle cx={650} cy={152} r={8} fill={BLOCK} />
				<circle cx={676} cy={152} r={8} fill={REVIEW} />
				<circle cx={702} cy={152} r={8} fill="#22C55E" />
				<path d="M650 212 l22 18 -22 18" stroke="#7BE3A3" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
				<text x={700} y={250} fontFamily={MONO} fontWeight={800} fontSize={64} fill="#7BE3A3">curl</text>
				<Bar x={888} y={222} w={210} h={14} fill="#4A4A4A" />
				<Bar x={650} y={290} w={300} h={14} fill="#3A3A3A" />
				<Bar x={970} y={290} w={128} h={14} fill="#3A3A3A" />
				<rect x={650} y={322} width={20} height={26} rx={4} fill={GOLD} />
				{/* open manual */}
				<path d="M610 568 Q 705 540 770 566 Q 835 540 930 568 L 930 728 Q 835 700 770 726 Q 705 700 610 728 Z" fill={STRAP} />
				<path d="M622 560 Q 700 538 770 562 L 770 712 Q 700 690 622 712 Z" fill={PAPER} stroke={HAIR} strokeWidth={3} />
				<path d="M770 562 Q 840 538 918 560 L 918 712 Q 840 690 770 712 Z" fill={PANEL} stroke={HAIR} strokeWidth={3} />
				<Bar x={646} y={590} w={90} h={12} />
				<Bar x={646} y={616} w={100} h={10} fill={HAIR} />
				<Bar x={646} y={638} w={70} h={10} fill={HAIR} />
				<Bar x={646} y={660} w={92} h={10} fill={HAIR} />
				<rect x={796} y={588} width={100} height={50} rx={8} fill={INK} />
				<Bar x={810} y={606} w={50} h={10} fill="#7BE3A3" />
				<Bar x={796} y={660} w={90} h={10} fill={HAIR} />
				{/* MCP plug into socket */}
				<rect x={1086} y={540} width={74} height={140} rx={14} fill={INK} />
				<rect x={1040} y={564} width={56} height={12} rx={4} fill="#9A958A" />
				<rect x={1040} y={642} width={56} height={12} rx={4} fill="#9A958A" />
				<rect x={940} y={534} width={110} height={142} rx={22} fill={GOLD} />
				<path d="M954 548 h60" stroke={GOLD_HI} strokeWidth={10} strokeLinecap="round" />
				<text x={995} y={617} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={30} fill={INK}>MCP</text>
			</g>
		}
		arms={
			<g>
				<path d="M440 330 C 510 330, 545 280, 550 215" {...limb} />
				<RestArm />
			</g>
		}
		front={<Hand x={590} y={405} />}
	/>
);

// ---------- 4. status ----------
export const PageStatus: React.FC = () => (
	<Stage
		pose="calm"
		ox={560}
		oy={190}
		back={
			<g>
				{/* heartbeat card */}
				<Card x={90} y={96} w={440} h={180} />
				{[0, 1, 2].map((i) => (
					<line key={i} x1={116} y1={140 + i * 46} x2={504} y2={140 + i * 46} stroke={HAIR} strokeWidth={3} />
				))}
				<polyline points="116,190 196,190 222,148 250,230 288,118 324,240 350,190 430,190 456,190" stroke={ALLOW} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
				<circle cx={490} cy={190} r={13} fill={ALLOW} />
				<circle cx={490} cy={190} r={22} fill="none" stroke="#7BE3A3" strokeWidth={5} />
				{/* status case */}
				<rect x={100} y={322} width={380} height={415} rx={32} fill={INK} opacity={0.1} />
				<rect x={90} y={310} width={380} height={415} rx={32} fill={INK} />
				{[0, 1, 2, 3].map((i) => {
					const y = 372 + i * 90;
					return (
						<g key={i}>
							<rect x={118} y={y - 34} width={324} height={68} rx={18} fill="#2B2B2B" />
							<circle cx={162} cy={y} r={30} fill="#7BE3A3" opacity={0.45} />
							<circle cx={162} cy={y} r={22} fill="#22C55E" />
							<circle cx={154} cy={y - 7} r={6} fill="#B8F2CC" />
							<Bar x={212} y={y - 12} w={150 - i * 14} h={14} fill="#5A5A5A" />
							<Bar x={212} y={y + 10} w={90} h={8} fill="#3F3F3F" />
							<path d={`M394 ${y} l10 10 l20 -22`} stroke="#7BE3A3" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
						</g>
					);
				})}
			</g>
		}
		arms={
			<g>
				<path d="M160 330 C 100 395, 0 420, -86 404" {...limb} />
				<RestArm left={false} />
			</g>
		}
		front={<Hand x={474} y={594} />}
	/>
);

// ---------- 5. receipt ----------
const zigzag = (x0: number, x1: number, y: number, step: number) => {
	let d = '';
	for (let x = x1; x > x0; x -= step) d += ` L${x - step / 2} ${y + 16} L${x - step} ${y}`;
	return d;
};

export const PageReceipt: React.FC = () => {
	const left = 640;
	const right = 940;
	const top = 60;
	const bottom = 706;
	const path = `M${left} ${top} H${right} V${bottom}${zigzag(left, right, bottom, 30)} Z`;
	const sealX = 800;
	const sealY = 590;
	const bumps = Array.from({length: 14}, (_, i) => {
		const a = (i / 14) * Math.PI * 2;
		return <circle key={i} cx={sealX + Math.cos(a) * 58} cy={sealY + Math.sin(a) * 58} r={14} fill={ALLOW} />;
	});
	return (
		<Stage
			pose="allow"
			back={
				<g transform="rotate(3 790 400)">
					<path d={path} transform="translate(12 12)" fill={INK} opacity={0.08} />
					<path d={path} fill={PAPER} stroke={HAIR} strokeWidth={4} />
					<RingMark x={720} y={128} r={30} />
					<Bar x={776} y={112} w={120} h={16} fill={INK} />
					<Bar x={776} y={138} w={80} h={10} />
					{[0, 1, 2, 3].map((i) => (
						<g key={i}>
							<Bar x={672} y={206 + i * 42} w={130 - (i % 2) * 24} h={12} />
							<Bar x={850} y={206 + i * 42} w={60} h={12} fill={HAIR} />
						</g>
					))}
					<line x1={672} y1={392} x2={908} y2={392} stroke={GREY} strokeWidth={4} strokeDasharray="10 10" />
					<Bar x={672} y={424} w={90} h={18} fill={INK} />
					<rect x={818} y={414} width={90} height={36} rx={18} fill={ALLOW} />
					<path d="M846 432 l10 10 l20 -22" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
					<path d="M674 504 q16 -52 30 -8 t28 4 t26 -26 t26 24 t30 -18 t26 8" stroke={INK} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
					<line x1={672} y1={522} x2={760} y2={522} stroke={GREY} strokeWidth={3} />
					{/* wax seal with ribbon tails */}
					<path d={`M${sealX - 30} ${sealY + 40} L${sealX - 52} ${sealY + 100} L${sealX - 28} ${sealY + 88} L${sealX - 14} ${sealY + 108} L${sealX - 6} ${sealY + 46} Z`} fill="#11803A" />
					<path d={`M${sealX + 30} ${sealY + 40} L${sealX + 52} ${sealY + 100} L${sealX + 28} ${sealY + 88} L${sealX + 14} ${sealY + 108} L${sealX + 6} ${sealY + 46} Z`} fill="#11803A" />
					{bumps}
					<circle cx={sealX} cy={sealY} r={58} fill={ALLOW} />
					<circle cx={sealX} cy={sealY} r={42} fill="none" stroke="#7BE3A3" strokeWidth={4} />
					<RingMark x={sealX - 6} y={sealY} r={22} />
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 500 345, 590 300, 615 190" {...limb} />
					<RestArm />
				</g>
			}
			front={<Hand x={657} y={380} />}
		/>
	);
};

// ---------- 6. pre-mortem ----------
// Keep reads a launch plan on a clipboard; two lines carry red risk marks, one a green tick.
export const PagePremortem: React.FC = () => {
	const lines: {mark: 'ok' | 'risk'; w: number}[] = [
		{mark: 'ok', w: 120},
		{mark: 'risk', w: 150},
		{mark: 'ok', w: 96},
		{mark: 'risk', w: 130},
	];
	return (
		<Stage
			pose="review"
			back={
				<g transform="rotate(-4 920 420)">
					{/* clipboard */}
					<rect x={772} y={142} width={320} height={500} rx={26} fill={INK} opacity={0.1} />
					<rect x={760} y={130} width={320} height={500} rx={26} fill={STRAP} />
					<rect x={784} y={164} width={272} height={444} rx={14} fill={PAPER} stroke={HAIR} strokeWidth={4} />
					<rect x={860} y={108} width={120} height={50} rx={14} fill={GOLD} />
					<rect x={892} y={96} width={56} height={26} rx={10} fill={GOLD_LO} />
					<RingMark x={838} y={226} r={20} />
					<Bar x={882} y={214} w={140} h={16} fill={INK} />
					<Bar x={882} y={240} w={92} h={10} />
					{lines.map((l, i) => {
						const y = 310 + i * 72;
						return (
							<g key={i}>
								<Bar x={820} y={y - 8} w={l.w} h={14} />
								<Bar x={820} y={y + 14} w={l.w - 40} h={10} fill={HAIR} />
								{l.mark === 'ok' ? (
									<path d={`M1000 ${y} l10 10 l20 -22`} stroke={ALLOW} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
								) : (
									<g>
										<circle cx={1014} cy={y + 2} r={24} fill="none" stroke={BLOCK} strokeWidth={6} />
										<rect x={1010} y={y - 12} width={8} height={18} rx={4} fill={BLOCK} />
										<circle cx={1014} cy={y + 14} r={4.5} fill={BLOCK} />
									</g>
								)}
							</g>
						);
					})}
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 520 360, 620 360, 708 300" {...limb} />
					<RestArm />
				</g>
			}
			front={<Hand x={748} y={490} />}
		/>
	);
};

// ---------- 7. launches ----------
// Keep points at a day-by-day board: bars of pools seen, the still-trading part filled green.
export const PageLaunches: React.FC = () => {
	const days = [
		{seen: 300, alive: 70},
		{seen: 250, alive: 40},
		{seen: 340, alive: 90},
		{seen: 210, alive: 30},
		{seen: 280, alive: 60},
	];
	const base = 600;
	return (
		<Stage
			pose="calm"
			ox={560}
			oy={190}
			back={
				<g>
					<Card x={70} y={110} w={500} h={560} />
					<RingMark x={122} y={164} r={22} />
					<Bar x={162} y={156} w={170} h={16} fill={INK} />
					<line x1={110} y1={base} x2={530} y2={base} stroke={GREY} strokeWidth={4} />
					{days.map((d, i) => {
						const x = 124 + i * 82;
						return (
							<g key={i}>
								<rect x={x} y={base - d.seen} width={52} height={d.seen} rx={10} fill={HAIR} />
								<rect x={x} y={base - d.alive} width={52} height={d.alive} rx={10} fill={ALLOW} />
								<Bar x={x + 6} y={base + 20} w={40} h={10} />
							</g>
						);
					})}
				</g>
			}
			arms={
				<g>
					<path d="M160 330 C 100 360, 20 330, -50 260" {...limb} />
					<RestArm left={false} />
				</g>
			}
			front={<Hand x={510} y={450} />}
		/>
	);
};

// ---------- 8. odds ----------
// Keep holds up a big dial: the green slice is the share still trading a day later.
export const PageOdds: React.FC = () => {
	const c = {x: 900, y: 380, r: 190};
	const slice = 0.22; // share of the circle drawn green; decorative, not a stat
	const a = slice * Math.PI * 2;
	const end = {x: c.x + Math.sin(a) * c.r, y: c.y - Math.cos(a) * c.r};
	return (
		<Stage
			pose="review"
			back={
				<g>
					<circle cx={c.x + 12} cy={c.y + 14} r={c.r} fill={INK} opacity={0.08} />
					<circle cx={c.x} cy={c.y} r={c.r} fill={PAPER} stroke={HAIR} strokeWidth={4} />
					<circle cx={c.x} cy={c.y} r={c.r - 30} fill={GREY} />
					<path d={`M${c.x} ${c.y} L${c.x} ${c.y - c.r + 30} A ${c.r - 30} ${c.r - 30} 0 0 1 ${c.x + Math.sin(a) * (c.r - 30)} ${c.y - Math.cos(a) * (c.r - 30)} Z`} fill={ALLOW} />
					<circle cx={c.x} cy={c.y} r={78} fill={PAPER} />
					<RingMark x={c.x} y={c.y} r={30} />
					<circle cx={end.x} cy={end.y} r={0} />
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 520 360, 600 330, 650 270" {...limb} />
					<RestArm />
				</g>
			}
			front={<Hand x={690} y={460} />}
		/>
	);
};

// ---------- 9. radar ----------
// Keep watches a radar screen; several blips share one label, a wave of copies.
export const PageRadar: React.FC = () => {
	const c = {x: 860, y: 400, r: 210};
	const blips = [
		{x: 800, y: 300},
		{x: 830, y: 330},
		{x: 780, y: 340},
		{x: 950, y: 470},
		{x: 1000, y: 330},
	];
	return (
		<Stage
			pose="calm"
			back={
				<g>
					<circle cx={c.x + 12} cy={c.y + 14} r={c.r} fill={INK} opacity={0.1} />
					<circle cx={c.x} cy={c.y} r={c.r} fill={INK} />
					{[0.33, 0.66].map((k) => (
						<circle key={k} cx={c.x} cy={c.y} r={c.r * k} fill="none" stroke="#3F3F3F" strokeWidth={4} />
					))}
					<line x1={c.x - c.r} y1={c.y} x2={c.x + c.r} y2={c.y} stroke="#3F3F3F" strokeWidth={4} />
					<line x1={c.x} y1={c.y - c.r} x2={c.x} y2={c.y + c.r} stroke="#3F3F3F" strokeWidth={4} />
					<path d={`M${c.x} ${c.y} L${c.x - c.r * 0.7} ${c.y - c.r * 0.7} A ${c.r} ${c.r} 0 0 1 ${c.x} ${c.y - c.r} Z`} fill="#22C55E" opacity={0.25} />
					{blips.map((b, i) => (
						<g key={i}>
							<circle cx={b.x} cy={b.y} r={i < 3 ? 13 : 10} fill={i < 3 ? REVIEW : '#7BE3A3'} />
							{i < 3 && <circle cx={b.x} cy={b.y} r={22} fill="none" stroke={REVIEW} strokeWidth={3} opacity={0.5} />}
						</g>
					))}
					<rect x={c.x - 60} y={c.y + c.r + 22} width={120} height={14} rx={7} fill={GREY} />
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 500 380, 560 390, 610 360" {...limb} />
					<RestArm />
				</g>
			}
			front={<Hand x={650} y={550} />}
		/>
	);
};

// ---------- 10. autopsy ----------
// Keep looks through a lens at one token's line: up at launch, then a drop.
export const PageAutopsy: React.FC = () => {
	const pts = '760,520 800,460 840,400 880,330 920,360 950,560 1000,600 1060,610';
	return (
		<Stage
			pose="review"
			back={
				<g>
					<Card x={720} y={200} w={380} h={460} />
					<RingMark x={770} y={250} r={20} />
					<Bar x={806} y={243} w={120} h={14} fill={INK} />
					<line x1={750} y1={620} x2={1070} y2={620} stroke={GREY} strokeWidth={4} />
					<polyline points={pts} stroke={INK} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
					<circle cx={920} cy={360} r={12} fill={REVIEW} />
					<circle cx={1060} cy={610} r={14} fill={BLOCK} />
				</g>
			}
			arms={
				<g>
					<path d="M440 330 C 500 390, 560 420, 620 420" {...limb} />
					<RestArm />
				</g>
			}
			front={
				<g>
					<line x1={884} y1={540} x2={670} y2={604} stroke={STRAP} strokeWidth={22} strokeLinecap="round" />
					<circle cx={950} cy={480} r={90} fill="#E4F2FF" opacity={0.5} />
					<circle cx={950} cy={480} r={90} fill="none" stroke={INK} strokeWidth={12} />
					<Hand x={662} y={608} />
				</g>
			}
		/>
	);
};

export const PAGE_ART: Record<string, React.FC> = {
	odds: PageOdds,
	radar: PageRadar,
	autopsy: PageAutopsy,
	gate: PageGate,
	check: PageCheck,
	docs: PageDocs,
	status: PageStatus,
	receipt: PageReceipt,
	premortem: PagePremortem,
	launches: PageLaunches,
};
