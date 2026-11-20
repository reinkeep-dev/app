# Reinkeep

Reinkeep is a pre-trade gate for AI agents on Robinhood Chain (chain id 4663). Before an agent pays or buys a token, it asks the gate and gets `ALLOW`, `REVIEW` or `BLOCK`, the rule that decided it, and an EIP-712 signed receipt anyone can re-check.

[Website](https://reinkeep.xyz) · [API docs for agents](https://api.reinkeep.xyz/llms.txt) · [OpenAPI](https://api.reinkeep.xyz/api/v1/openapi.json) · [Status](https://api.reinkeep.xyz/status) · [X @reinkeepgate](https://x.com/reinkeepgate) · [Changelog](CHANGELOG.md)

## Use it

Check a token for free, no key needed:

```bash
curl https://api.reinkeep.xyz/api/v1/verdict/0xTOKEN_ADDRESS
```

Gate a payment before the agent sends it:

```bash
curl -X POST https://api.reinkeep.xyz/api/v1/gate \
  -H 'content-type: application/json' \
  -d '{"request":{"network":"eip155:4663","asset":"0x...","amount":"100000","decimals":6,"payTo":"0x...","resourceUrl":"https://...","validForSeconds":60}}'
```

Connect an agent over MCP: `https://api.reinkeep.xyz/mcp` (remote MCP, POST).

Each IP gets 25 free gate calls a day. After that a call costs $0.01 in USDG, paid with x402 (the HTTP 402 pay-per-call flow). Live numbers: [`/api/v1/gate/pricing`](https://api.reinkeep.xyz/api/v1/gate/pricing).

Every endpoint, request field and token rule is listed in [`api/README.md`](api/README.md).

## What's in this repo

| Folder | What |
|---|---|
| `api/` | The gate: Cloudflare Worker with receipts, x402 payments, free tier, mandates (watch a token you hold), MCP server |
| `engine/` | The rules (`policy.ts`), shared by the API, the website demo and the local guard |
| `site-family/` | The website at reinkeep.xyz |
| `studio/` | Remotion project for page art, share cards and X images |
| `collector/` | Token data collector. It runs from GitHub Actions in [reinkeep-dev/data](https://github.com/reinkeep-dev/data) |
| `test/` | Tests for the API, token rules and collector |

The local guard (CLI, MCP over stdio and a signer wrapper, no network needed) and the hosted MCP guide live in [reinkeep-dev/mcp](https://github.com/reinkeep-dev/mcp).

## Develop

Node.js 22 or newer.

```bash
npm install
npm test             # all tests
npm run typecheck
npm run api:dev      # local gate at http://127.0.0.1:4190, throwaway signing key
```

## Versions and releases

Versions follow [Semantic Versioning](https://semver.org/). Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(api): ...`, `fix(site): ...`), and `CHANGELOG.md` is generated from them with [git-cliff](https://git-cliff.org).

To cut a release:

1. Bump `version` in `package.json`.
2. Regenerate the changelog and commit both:
   `GITHUB_REPO=reinkeep-dev/app npx git-cliff@2 --tag-pattern '^v[0-9]' --tag vX.Y.Z -o CHANGELOG.md`
3. After it lands on `main`, tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`

`main` cannot be force-pushed or deleted.

## License

Business Source License 1.1 (see [`LICENSE`](LICENSE)). You can read, change and run this code, including in production,
as long as you do not offer it as a competing payment or pre-trade gate for AI agents. On 2028-11-20 it becomes MIT.
The engine (`engine/`) and the collector (`collector/`) are also MIT in [reinkeep-dev/mcp](https://github.com/reinkeep-dev/mcp)
and [reinkeep-dev/data](https://github.com/reinkeep-dev/data).
