// Code samples shared by the Gate and Docs pages. Facts come from api/README.md and the live llms.txt.
import { GATE } from '@/features/gate-tool/gate-api'

export const CURL_GATE = `curl -s ${GATE}/api/v1/gate \\
  -H 'content-type: application/json' -d '{
  "request": {
    "network": "eip155:4663",
    "asset": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "amount": "10000",
    "decimals": 6,
    "payTo": "0x1111111111111111111111111111111111111111",
    "resourceUrl": "https://api.example.com/v1/data",
    "validForSeconds": 90
  }
}'`

export const MCP_URL = `${GATE}/mcp`
export const MCP_CLAUDE = `claude mcp add --transport http reinkeep ${MCP_URL}`
export const MCP_JSON = `{
  "mcpServers": {
    "reinkeep": { "url": "${MCP_URL}" }
  }
}`
