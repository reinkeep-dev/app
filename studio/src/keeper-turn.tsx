import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {Keeper} from './keeper-mark';
import {Stage} from './render-stage';

// One frame per yaw step. The site shows the frame that matches the pointer, so this is a turntable,
// not a timed animation: frame 0 = turned left, last frame = turned right.
export const TURN_FRAMES = 61;
export const TURN_SPAN_DEG = 110;

export const KeeperTurn: React.FC = () => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const t = frame / (durationInFrames - 1);
	const yaw = ((t - 0.5) * TURN_SPAN_DEG * Math.PI) / 180;
	return (
		<Stage camZ={7.4}>
			<Keeper rotation={[0.16, yaw, -0.06]} />
		</Stage>
	);
};
