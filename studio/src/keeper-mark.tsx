import React, {useMemo} from 'react';
import * as THREE from 'three';

// The Reinkeep mark in 3D: a flat brass ring with a strap looped around its right side,
// matching brand/logo.webp (ring on the left, strap running out to the right).

export const BRASS = '#D4A94F';

export const ringMaterial = () =>
	new THREE.MeshPhysicalMaterial({color: BRASS, metalness: 1, roughness: 0.2, clearcoat: 0.35, clearcoatRoughness: 0.25});

export const strapMaterial = () =>
	new THREE.MeshPhysicalMaterial({color: '#C99B42', metalness: 1, roughness: 0.36, clearcoat: 0.2, clearcoatRoughness: 0.4});

// Top view (x, z) of the strap: a U that wraps the ring tube at x=1, front leg long, back leg short.
// Extruded along y, so the strap reads as a flat band with softened edges.
const strapGeometry = () => {
	const outer = 0.245;
	const inner = 0.155;
	const s = new THREE.Shape();
	s.moveTo(2.15, outer);
	s.lineTo(1.0, outer);
	s.absarc(1.0, 0, outer, Math.PI / 2, (3 * Math.PI) / 2, false);
	s.lineTo(1.55, -outer);
	s.lineTo(1.55, -inner);
	s.lineTo(1.0, -inner);
	s.absarc(1.0, 0, inner, (3 * Math.PI) / 2, Math.PI / 2, true);
	s.lineTo(2.15, inner);
	s.closePath();
	const g = new THREE.ExtrudeGeometry(s, {
		depth: 0.7,
		bevelEnabled: true,
		bevelThickness: 0.04,
		bevelSize: 0.03,
		bevelSegments: 6,
		curveSegments: 48,
	});
	// The shape was drawn in x/y; turn it so y becomes depth (z) and the extrusion becomes height (y).
	g.rotateX(Math.PI / 2);
	g.translate(0, 0.35, 0);
	return g;
};

export const Keeper: React.FC<{position?: [number, number, number]; rotation?: [number, number, number]; scale?: number}> = ({
	position = [0, 0, 0],
	rotation = [0, 0, 0],
	scale = 1,
}) => {
	const ring = useMemo(() => new THREE.TorusGeometry(1, 0.15, 64, 220), []);
	const strap = useMemo(strapGeometry, []);
	const rm = useMemo(ringMaterial, []);
	const sm = useMemo(strapMaterial, []);
	return (
		<group position={position} rotation={rotation} scale={scale}>
			{/* centre the whole mark: ring spans -1..1, strap reaches 2.18 */}
			<group position={[-0.55, 0, 0]}>
				<mesh geometry={ring} material={rm} scale={[1, 1, 0.72]} />
				<mesh geometry={strap} material={sm} />
			</group>
		</group>
	);
};
