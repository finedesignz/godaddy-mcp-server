# GoDaddy MCP Server

MCP server for GoDaddy domain management. Provides tools to list, purchase, transfer, renew, and configure domains and DNS records via the [GoDaddy API](https://developer.godaddy.com/doc/endpoint/domains).

## Tools

| Tool | Description |
|------|-------------|
| `list_domains` | List all domains in the account |
| `get_domain` | Get domain details (status, nameservers, expiration) |
| `check_availability` | Check if a domain is available for purchase |
| `update_domain` | Update lock, nameservers, auto-renew settings |
| `cancel_domain` | Cancel a domain registration |
| `purchase_domain` | Register a new domain |
| `renew_domain` | Renew a domain registration |
| `transfer_domain` | Transfer a domain into GoDaddy |
| `get_dns_records` | Get DNS records (filter by type/name) |
| `add_dns_records` | Add DNS records without removing existing |
| `replace_dns_records` | Replace DNS records (all, by type, or by type+name) |
| `delete_dns_records` | Delete DNS records by type and name |
| `update_contacts` | Update admin/billing/registrant/tech contacts |
| `purchase_privacy` | Buy WHOIS privacy for a domain |
| `cancel_privacy` | Remove WHOIS privacy |
| `verify_registrant_email` | Re-send registrant email verification |
| `get_tlds` | List supported TLDs |
| `get_agreements` | Get legal agreements for purchase/transfer |

## Setup

Get your API key and secret from [developer.godaddy.com/keys](https://developer.godaddy.com/keys).

### Claude Code

Add to your MCP settings (`.claude/settings.json` or global):

```json
{
  "mcpServers": {
    "godaddy": {
      "command": "npx",
      "args": ["-y", "godaddy-mcp-server", "--api-key", "YOUR_KEY", "--api-secret", "YOUR_SECRET"]
    }
  }
}
```

### Docker

```json
{
  "mcpServers": {
    "godaddy": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "godaddy-mcp-server", "--api-key", "YOUR_KEY", "--api-secret", "YOUR_SECRET"]
    }
  }
}
```

Use `--env ote` for the GoDaddy test environment.

### Build from source

```bash
npm install
npm run build
node dist/index.js --api-key YOUR_KEY --api-secret YOUR_SECRET
```

## Docker build

```bash
docker build -t godaddy-mcp-server .
docker run --rm -i godaddy-mcp-server --api-key YOUR_KEY --api-secret YOUR_SECRET
```
