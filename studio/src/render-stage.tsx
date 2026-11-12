import React from 'react';
import {ThreeCanvas} from '@remotion/three';
import {Environment, Lightformer} from '@react-three/drei';
import {useVideoConfig} from 'remotion';

// Shared studio: pure black background (the site blends renders with `screen`, so black turns clear),
// and a hand-built light studio for the metal to reflect. No HDR files, nothing fetched at render time.
export const Stage: React.FC<{children: React.ReactNode; camZ?: number; fov?: number; size?: [number, number]}> = ({
	children,
	camZ = 7,
	fov = 30,
	size,
}) => {
	const video = useVideoConfig();
	const [width, height] = size ?? [video.width, video.height];
	return (
		<ThreeCanvas
			width={width}
			height={height}
			style={{backgroundColor: '#000'}}
			camera={{fov, position: [0, 0, camZ]}}
			gl={{antialias: true, preserveDrawingBuffer: true}}
		>
			<color attach="background" args={['#000']} />
			<ambientLight intensity={0.05} />
			<directionalLight position={[-3, 4, 5]} intensity={1.2} color="#FFF1D6" />
			<Environment resolution={512} frames={1}>
				{/* a warm dark room instead of pure black, so flat metal faces never read as holes */}
				<color attach="background" args={['#1C140A']} />
				{/* big soft key from above-front */}
				<Lightformer form="rect" intensity={3.2} color="#FFF4DF" position={[0, 5, 3]} rotation-x={Math.PI / 2.4} scale={[10, 4, 1]} />
				{/* broad front fill behind the camera: lights the flat strap face */}
				<Lightformer form="rect" intensity={1.1} color="#FFE2A8" position={[0, -0.5, 8]} scale={[12, 6, 1]} />
				{/* low bounce from below, like a brass floor */}
				<Lightformer form="rect" intensity={0.8} color="#B07A2A" position={[0, -5, 1]} rotation-x={-Math.PI / 2} scale={[10, 6, 1]} />
				{/* tall strips left and right give the long highlights along the ring */}
				<Lightformer form="rect" intensity={3} color="#FFE7B8" position={[-5, 0.5, 1]} rotation-y={Math.PI / 2} scale={[0.6, 8, 1]} />
				<Lightformer form="rect" intensity={1.6} color="#FFFFFF" position={[5, 1, -1]} rotation-y={-Math.PI / 2} scale={[0.4, 8, 1]} />
				{/* warm rim from behind */}
				<Lightformer form="ring" intensity={2} color="#E9A53A" position={[2, 2, -6]} scale={3} />
			</Environment>
			{children}
		</ThreeCanvas>
	);
};
