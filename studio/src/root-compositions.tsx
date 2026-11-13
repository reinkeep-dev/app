import React from 'react';
import {Composition, Still} from 'remotion';
import {KeeperTurn, TURN_FRAMES} from './keeper-turn';
import {HeroField, FIELD_FRAMES} from './hero-field';
import {CardGate, CardReceipt, CardRules, DoorBuys, DoorPays, OgImage, SplitLayers} from './asset-stills';
import {KeepMascot, type Pose} from './keep-mascot';
import {STICKERS, Sticker} from './family-stickers';
import {PAGE_ART} from './page-art';
import {OgCard} from './og-card';
import {XAvatar, XHeader} from './x-profile';
import {XAvatar3D, XAvatar3DWow} from './x-avatar-3d';
import {RingLand, LAND_FRAMES} from './ring-land';
import {XAvatarSlip, XAvatarVault, XAvatarVerdict, XHeaderSlip, XHeaderVault, XHeaderVerdict} from './x-profile-v3';

const POSES: Pose[] = ['hello', 'allow', 'review', 'block', 'calm'];

// Every visual asset on the site comes from one of these. render-assets.mjs renders the ../site ones,
// render-family-assets.mjs the ../site-family ones (Keep-* and Sticker-*).
export const RootCompositions: React.FC = () => (
	<>
		<Composition id="KeeperTurn" component={KeeperTurn} durationInFrames={TURN_FRAMES} fps={30} width={1080} height={1080} />
		<Composition id="HeroField" component={HeroField} durationInFrames={FIELD_FRAMES} fps={30} width={1920} height={1080} />
		<Still id="CardGate" component={CardGate} width={900} height={900} />
		<Still id="CardRules" component={CardRules} width={900} height={900} />
		<Still id="CardReceipt" component={CardReceipt} width={900} height={900} />
		<Still id="DoorPays" component={DoorPays} width={1000} height={1000} />
		<Still id="DoorBuys" component={DoorBuys} width={1000} height={1000} />
		<Still id="SplitLayers" component={SplitLayers} width={1000} height={1000} />
		<Still id="OgImage" component={OgImage} width={1200} height={630} />
		<Still id="OgCard" component={OgCard} width={1200} height={630} defaultProps={{card: 'Your agent pays.\nYou hold the reins.', art: 'home'}} />
		{/* X profile art (rendered by hand: npx remotion still XAvatar / XHeader) */}
		<Still id="XAvatar" component={XAvatar} width={400} height={400} />
		<Still id="XHeader" component={XHeader} width={1500} height={500} />
		<Still id="XAvatar3D-Plain" component={XAvatar3D} defaultProps={{grid: false}} width={800} height={800} />
		<Still id="XAvatar3D-Grid" component={XAvatar3D} defaultProps={{grid: true}} width={800} height={800} />
		{/* launch film hero sprite (rendered to PNG frames by hand) */}
		<Composition id="RingLand" component={RingLand} durationInFrames={LAND_FRAMES} fps={30} width={720} height={720} />
		<Still id="XAvatar3D-Wow" component={XAvatar3DWow} width={800} height={800} />
		{/* X profile art v3: three directions (rendered by hand: npx remotion still XAvatar-Vault etc.) */}
		<Still id="XAvatar-Vault" component={XAvatarVault} width={400} height={400} />
		<Still id="XHeader-Vault" component={XHeaderVault} width={1500} height={500} />
		<Still id="XAvatar-Slip" component={XAvatarSlip} width={400} height={400} />
		<Still id="XHeader-Slip" component={XHeaderSlip} width={1500} height={500} />
		<Still id="XAvatar-Verdict" component={XAvatarVerdict} width={400} height={400} />
		<Still id="XHeader-Verdict" component={XHeaderVerdict} width={1500} height={500} />
		{POSES.map((pose) => (
			<Still key={pose} id={`Keep-${pose}`} component={KeepMascot} defaultProps={{pose}} width={900} height={900} />
		))}
		{/* page illustrations, rendered by render-page-art.mjs */}
		{Object.entries(PAGE_ART).map(([name, Art]) => (
			<Still key={name} id={`PageArt-${name}`} component={Art} width={1200} height={900} />
		))}
		{STICKERS.map((name) => (
			<Still key={name} id={`Sticker-${name}`} component={Sticker} defaultProps={{name}} width={400} height={400} />
		))}
	</>
);
