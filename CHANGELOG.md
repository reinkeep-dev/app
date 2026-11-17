# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-11-17

### Bug Fixes
- **launch-data:** Never count a pulled pool as still trading
- **api:** Require payer signature, ipv6 free tier per /64
- **site:** Point github links to reinkeep-dev and x handle to @reinkeepgate
- **api:** Stop the guard from dropping most ai notes


### Documentation
- Drop other projects' names from code comments


### Features
- **api:** Pay mandates in the token, burned via permit2; holder check
- **site:** Live simulations on tool pages, ca slot, speed fixes
- **domain:** Serve site and api on reinkeep.xyz
- **studio:** Add 3d x avatar and header options
- **api:** Email alerts for mandates via resend
- **studio:** Transparent stage and ring landing sprite
- **site:** Per-page share cards, sitemap and titles
- **api:** Cap workers ai neurons per day


### Miscellaneous Tasks
- Initial snapshot of reinkeep
- Move collector workflow to the public data repo
- **collector:** Sync run-ci with reinkeep/data
- Stop tracking non-code folders


### Testing
- **api:** Stop the explain timeout test from flaking


