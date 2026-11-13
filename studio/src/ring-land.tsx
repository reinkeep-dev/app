import React from 'react';
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Keeper} from './keeper-mark';
import {Stage} from './render-stage';

// The launch film's hero: the 3D mark turning from a steep, tumbling angle into the same pose as the X avatar.
// Rendered with alpha (transparent PNGs). Rotation only: the film moves and
// scales the sprite itself, so the arrival curve lives in one place.
export const LAND_FRAMES = 36;
const FINAL: [number, number, number] = [0.28, -0.42, -0.08];
const START: [number, number, number] = [1.35, -2.6, 0.6];

export const RingLand: React.FC = () => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const t = interpolate(frame, [0, durationInFrames - 1], [0, 1], {easing: Easing.out(Easing.cubic)});
	const rot = START.map((s, i) => s + (FINAL[i] - s) * t) as [number, number, number];
	return (
		<Stage camZ={7.6} transparent>
			<Keeper position={[-0.05, -0.11, 0]} rotation={rot} scale={0.9} />
		</Stage>
	);
};
