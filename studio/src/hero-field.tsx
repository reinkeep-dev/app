import React, {useMemo} from 'react';
import * as THREE from 'three';
import {ThreeCanvas} from '@remotion/three';
import {useCurrentFrame, useVideoConfig} from 'remotion';

// Seamless loop behind the hero: a brass grid floor running to a warm horizon, with slow dust.
// The camera moves exactly one grid cell per loop, and dust wraps by modulo, so frame 0 == last frame + 1.
export const FIELD_FRAMES = 240;
const CELL = 1;
const HALF = 40;

const gridGeometry = () => {
	const pts: number[] = [];
	for (let i = -HALF; i <= HALF; i++) {
		pts.push(i * CELL, 0, -HALF * 2, i * CELL, 0, HALF / 2);
	}
	for (let j = -HALF * 2; j <= HALF / 2; j++) {
		pts.push(-HALF * CELL, 0, j * CELL, HALF * CELL, 0, j * CELL);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
	return g;
};

// Fixed seed so every render gives the same dust.
const rand = (i: number) => {
	const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

const DUST = 260;

const glowTexture = () => {
	const c = document.createElement('canvas');
	c.width = c.height = 256;
	const x = c.getContext('2d')!;
	const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
	g.addColorStop(0, 'rgba(255,214,140,0.95)');
	g.addColorStop(0.35, 'rgba(212,169,79,0.35)');
	g.addColorStop(1, 'rgba(212,169,79,0)');
	x.fillStyle = g;
	x.fillRect(0, 0, 256, 256);
	return new THREE.CanvasTexture(c);
};

export const HeroField: React.FC = () => {
	const frame = useCurrentFrame();
	const {width, height, durationInFrames} = useVideoConfig();
	const t = frame / durationInFrames;
	const grid = useMemo(gridGeometry, []);
	const glow = useMemo(glowTexture, []);
	const dust = useMemo(() => {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3));
		return g;
	}, []);

	// Dust rises a full cycle per loop; each mote has its own phase.
	const pos = dust.getAttribute('position') as THREE.BufferAttribute;
	for (let i = 0; i < DUST; i++) {
		const phase = (rand(i * 3) + t) % 1;
		pos.setXYZ(i, (rand(i * 3 + 1) - 0.5) * 30, phase * 9 - 0.5, -rand(i * 3 + 2) * 30 + 2);
	}
	pos.needsUpdate = true;

	return (
		<ThreeCanvas width={width} height={height} style={{backgroundColor: '#000'}} camera={{fov: 42, position: [0, 1.6, 6]}}>
			<color attach="background" args={['#000']} />
			<fog attach="fog" args={['#000', 4, 34]} />
			<group position={[0, 0, t * CELL]} rotation={[0, 0, 0]}>
				<lineSegments geometry={grid}>
					<lineBasicMaterial color="#D4A94F" transparent opacity={0.42} />
				</lineSegments>
			</group>
			{/* horizon glow: a big soft sprite low on the horizon, breathing a little */}
			<sprite position={[0, 1.2, -26]} scale={[46 + Math.sin(t * Math.PI * 2) * 2, 14, 1]}>
				<spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
			</sprite>
			<points geometry={dust}>
				<pointsMaterial color="#F3D9A0" size={0.045} sizeAttenuation transparent opacity={0.8} depthWrite={false} />
			</points>
		</ThreeCanvas>
	);
};
