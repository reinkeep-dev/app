import React from 'react';
import {AbsoluteFill} from 'remotion';
import {INK, KeepMascot, type Pose} from './keep-mascot';
import {PAGE_ART} from './page-art';
import {useInter} from './x-profile-v3';

// Square image for one X post (1080x1080), in the site's look: cream ground, the page's Keep illustration on top,
// one big line and one small line under it, the page address at the bottom. Every number on it must come from
// the live API on the day it is rendered (launch-kit/X-POSTS.md says where).

export type PostCardProps = {big: string; line: string; art: string; url: string};

export const PostCard: React.FC<PostCardProps> = ({big, line, art, url}) => {
	useInter();
	// 'keep-<pose>' shows Keep alone: for posts whose page art is a chart that would not match the post's number.
	const pose = art.startsWith('keep-') ? (art.slice(5) as Pose) : null;
	const Art = PAGE_ART[art];
	const size = big.length > 26 ? 66 : big.length > 12 ? 84 : 150;
	return (
		<AbsoluteFill style={{backgroundColor: '#F7F6F3', color: INK, fontFamily: '"Inter Site", system-ui, sans-serif'}}>
			{/* page art is 1200x900: shown at 0.7 -> 840x630, centred */}
			{pose ? (
				<div style={{position: 'absolute', left: 250, top: 10, width: 580, height: 580}}>
					<KeepMascot pose={pose} />
				</div>
			) : (
				<div style={{position: 'absolute', left: 120, top: 10, width: 1200, height: 900, transform: 'scale(0.7)', transformOrigin: '0 0'}}>
					<Art />
				</div>
			)}
			<div style={{position: 'absolute', left: 90, right: 90, top: 640}}>
				<p style={{margin: 0, fontSize: size, fontWeight: 650, lineHeight: 1.02, letterSpacing: '-0.04em'}}>{big}</p>
				<p style={{margin: '22px 0 0', fontSize: 34, lineHeight: 1.3, color: 'rgba(26,26,26,.65)', maxWidth: 860}}>{line}</p>
			</div>
			<div style={{position: 'absolute', left: 90, bottom: 56, fontSize: 28, fontWeight: 600}}>{url}</div>
		</AbsoluteFill>
	);
};
