import React, {useMemo} from 'react';
import * as THREE from 'three';
import {RoundedBox} from '@react-three/drei';
import {AbsoluteFill} from 'remotion';
import {Keeper, ringMaterial, strapMaterial} from './keeper-mark';
import {Stage} from './render-stage';

// Still images for the cards and split panels. Each is rendered once as a PNG on black.

const darkBrass = () => new THREE.MeshPhysicalMaterial({color: '#6E5222', metalness: 1, roughness: 0.42});

// The 16 rules: a 4x4 board of brass tiles, the ones that block are raised and polished.
const RAISED = new Set([1, 4, 6, 9, 11, 14]);
export const CardRules: React.FC = () => {
	const hi = useMemo(ringMaterial, []);
	const lo = useMemo(darkBrass, []);
	return (
		<Stage camZ={12} fov={28}>
			<group rotation={[0.95, 0, -0.62]}>
				{Array.from({length: 16}, (_, i) => {
					const x = (i % 4) - 1.5;
					const y = Math.floor(i / 4) - 1.5;
					const up = RAISED.has(i);
					return (
						<RoundedBox key={i} args={[0.86, 0.86, up ? 0.5 : 0.18]} radius={0.06} smoothness={6} position={[x, y, up ? 0.25 : 0.09]} material={up ? hi : lo} />
					);
				})}
			</group>
		</Stage>
	);
};

// Receipts: a brass tag hanging from the ring, the tag carries the punched hole.
export const CardReceipt: React.FC = () => {
	const rm = useMemo(ringMaterial, []);
	const sm = useMemo(strapMaterial, []);
	const ring = useMemo(() => new THREE.TorusGeometry(0.7, 0.09, 48, 160), []);
	return (
		<Stage camZ={10} fov={28}>
			<group rotation={[0.2, -0.55, 0.12]} position={[0, -0.25, 0]}>
				<mesh geometry={ring} material={rm} position={[0, 1.15, 0]} rotation={[0, Math.PI / 2.4, 0]} scale={[1, 1, 0.75]} />
				<group position={[0, -0.45, 0]} rotation={[0, 0, 0.08]}>
					<RoundedBox args={[1.6, 2.2, 0.08]} radius={0.04} smoothness={6} material={sm} />
					{/* punched hole near the top, sitting on the ring */}
					<mesh position={[0, 0.82, 0]} rotation={[Math.PI / 2, 0, 0]}>
						<cylinderGeometry args={[0.13, 0.13, 0.12, 48]} />
						<meshBasicMaterial color="#000" />
					</mesh>
					{/* engraved lines, like a printed slip */}
					{[0.3, 0.05, -0.2, -0.45, -0.7].map((y, i) => (
						<RoundedBox key={i} args={[i === 4 ? 0.7 : 1.15, 0.07, 0.02]} radius={0.01} position={[i === 4 ? -0.22 : 0, y, 0.05]} material={rm} />
					))}
				</group>
			</group>
		</Stage>
	);
};

export const CardGate: React.FC<{size?: [number, number]}> = ({size}) => (
	<Stage camZ={7.2} size={size}>
		<Keeper rotation={[0.3, -0.62, -0.12]} />
	</Stage>
);

// Doors section, "How it pays": the mark seen close and low, so the strap (the payment side) leads.
export const DoorPays: React.FC = () => (
	<Stage camZ={7.8} fov={28}>
		{/* yaw kept under ~0.6 so the strap's flat face still turns toward the key light instead of going dark */}
		<Keeper rotation={[0.32, -0.55, 0.1]} position={[0.05, 0, 0]} />
	</Stage>
);

// Doors section, "What it buys": a token coin under a brass magnifier. The lens is clear glass,
// so the coin's face reads through it: the gate inspects what is being bought.
export const DoorBuys: React.FC = () => {
	const rm = useMemo(ringMaterial, []);
	const sm = useMemo(strapMaterial, []);
	const face = useMemo(() => new THREE.CylinderGeometry(0.95, 0.95, 0.14, 128), []);
	const rim = useMemo(() => new THREE.TorusGeometry(0.95, 0.07, 32, 160), []);
	const inner = useMemo(() => new THREE.TorusGeometry(0.48, 0.045, 24, 128), []);
	const lensRim = useMemo(() => new THREE.TorusGeometry(0.72, 0.075, 32, 160), []);
	const glass = useMemo(
		() => new THREE.MeshPhysicalMaterial({color: '#FFF6E2', metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.25, ior: 1.45, transparent: true, opacity: 0.35}),
		[],
	);
	return (
		<Stage camZ={9.4} fov={28}>
			{/* frame half-width here is about 2.3 units; everything below stays inside about -1.6..1.6 */}
			{/* coin leaned back only part way, so it does not mirror the overhead light straight into the camera */}
			<group position={[-0.5, -0.4, 0]} rotation={[0.72, 0, -0.25]}>
				<mesh geometry={face} material={sm} />
				<mesh geometry={rim} material={rm} rotation={[Math.PI / 2, 0, 0]} />
				<mesh geometry={inner} material={rm} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} />
			</group>
			{/* magnifier above it, tilted toward the camera, handle running out to the lower right */}
			<group position={[0.15, 0.35, 1.1]} rotation={[0.35, -0.35, 0.15]} scale={0.9}>
				<mesh geometry={lensRim} material={rm} />
				{/* cylinders stand on Y and the torus faces Z, so the glass is turned to sit inside the rim */}
				<mesh material={glass} rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[0.7, 0.7, 0.05, 96]} />
				</mesh>
				<mesh material={sm} position={[0.92, -0.92, 0]} rotation={[0, 0, Math.PI / 4]}>
					<cylinderGeometry args={[0.09, 0.11, 1.15, 48]} />
				</mesh>
			</group>
		</Stage>
	);
};

// Build section: three stacked layers (Signer, MCP, CLI), exploded upward.
export const SplitLayers: React.FC = () => {
	const hi = useMemo(ringMaterial, []);
	const mid = useMemo(strapMaterial, []);
	const lo = useMemo(darkBrass, []);
	return (
		<Stage camZ={10} fov={28}>
			<group rotation={[0.62, 0.72, 0]} position={[0, -0.2, 0]}>
				<RoundedBox args={[2.6, 0.22, 2.6]} radius={0.06} smoothness={6} position={[0, 1.15, 0]} material={hi} />
				<RoundedBox args={[2.6, 0.22, 2.6]} radius={0.06} smoothness={6} position={[0, 0, 0]} material={mid} />
				<RoundedBox args={[2.6, 0.22, 2.6]} radius={0.06} smoothness={6} position={[0, -1.15, 0]} material={lo} />
			</group>
		</Stage>
	);
};

// Link preview image (1200x630): the mark on the left, the name and line on the right.
export const OgImage: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: '#0A0907'}}>
		<AbsoluteFill style={{left: -60, width: 630, height: 630}}>
			<CardGate size={[630, 630]} />
		</AbsoluteFill>
		<AbsoluteFill style={{left: 610, justifyContent: 'center', color: '#F2EDE3', fontFamily: 'Inter, system-ui, sans-serif'}}>
			<div style={{fontSize: 30, letterSpacing: 6, color: '#D4A94F', textTransform: 'uppercase'}}>Reinkeep</div>
			<div style={{fontSize: 62, lineHeight: 1.08, fontWeight: 500, marginTop: 18, maxWidth: 520}}>Hold the reins on your AI agent.</div>
			<div style={{fontSize: 24, color: '#9C9488', marginTop: 22, maxWidth: 500}}>ALLOW, REVIEW or BLOCK before it pays. Early access.</div>
		</AbsoluteFill>
	</AbsoluteFill>
);
