import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoDaddyClient } from "./godaddy-client.js";

// ── Parse CLI args ───────────────────────────────────────────────
function parseArgs(): { apiKey: string; apiSecret: string; env: "production" | "ote" } {
  const args = process.argv.slice(2);
  let apiKey = "";
  let apiSecret = "";
  let env: "production" | "ote" = "production";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-key" && args[i + 1]) apiKey = args[++i];
    else if (args[i] === "--api-secret" && args[i + 1]) apiSecret = args[++i];
    else if (args[i] === "--env" && args[i + 1]) env = args[++i] as "production" | "ote";
  }

  if (!apiKey || !apiSecret) {
    console.error("Usage: godaddy-mcp-server --api-key <KEY> --api-secret <SECRET> [--env production|ote]");
    process.exit(1);
  }

  return { apiKey, apiSecret, env };
}

const config = parseArgs();
const gd = new GoDaddyClient(config);

// ── Helper ───────────────────────────────────────────────────────
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// ── MCP Server ───────────────────────────────────────────────────
const server = new McpServer({
  name: "godaddy",
  version: "1.0.0",
});

// ─── List Domains ────────────────────────────────────────────────
server.tool(
  "list_domains",
  "List all domains in the GoDaddy account. Optionally filter by status.",
  {
    statuses: z.string().optional().describe("Comma-separated statuses: ACTIVE, CANCELLED, etc."),
    limit: z.number().optional().describe("Max results to return (default 100)"),
    marker: z.string().optional().describe("Marker for pagination"),
  },
  async ({ statuses, limit, marker }) => {
    const result = await gd.listDomains({ statuses, limit, marker });
    return json(result);
  }
);

// ─── Get Domain Details ──────────────────────────────────────────
server.tool(
  "get_domain",
  "Get detailed information about a specific domain including status, nameservers, contacts, and expiration.",
  { domain: z.string().describe("Domain name (e.g. example.com)") },
  async ({ domain }) => json(await gd.getDomain(domain))
);

// ─── Check Domain Availability ───────────────────────────────────
server.tool(
  "check_availability",
  "Check if a domain name is available for purchase.",
  {
    domain: z.string().describe("Domain to check (e.g. example.com)"),
    checkType: z.enum(["FAST", "FULL"]).optional().describe("FAST for quick check, FULL for detailed pricing"),
  },
  async ({ domain, checkType }) => json(await gd.checkAvailability(domain, checkType))
);

// ─── Update Domain ───────────────────────────────────────────────
server.tool(
  "update_domain",
  "Update domain settings like lock status, nameservers, or auto-renew.",
  {
    domain: z.string().describe("Domain name"),
    locked: z.boolean().optional().describe("Enable/disable domain lock"),
    nameServers: z.array(z.string()).optional().describe("Set custom nameservers"),
    renewAuto: z.boolean().optional().describe("Enable/disable auto-renewal"),
    subaccountId: z.string().optional().describe("Reseller subaccount ID"),
  },
  async ({ domain, ...update }) => json(await gd.updateDomain(domain, update))
);

// ─── Cancel Domain ───────────────────────────────────────────────
server.tool(
  "cancel_domain",
  "Cancel a purchased domain registration.",
  { domain: z.string().describe("Domain name to cancel") },
  async ({ domain }) => json(await gd.cancelDomain(domain))
);

// ─── Purchase Domain ─────────────────────────────────────────────
server.tool(
  "purchase_domain",
  "Purchase and register a new domain. Requires consent and contact information.",
  {
    domain: z.string().describe("Domain to purchase"),
    agreedAt: z.string().describe("ISO 8601 timestamp of agreement"),
    agreedBy: z.string().describe("IP address of the agreeing party"),
    agreementKeys: z.array(z.string()).describe("Agreement keys from get_agreements"),
    period: z.number().optional().describe("Registration period in years (default 1)"),
    privacy: z.boolean().optional().describe("Purchase privacy protection"),
    renewAuto: z.boolean().optional().describe("Auto-renew (default true)"),
    nameServers: z.array(z.string()).optional().describe("Custom nameservers"),
    contactRegistrant: z.object({
      nameFirst: z.string(),
      nameLast: z.string(),
      email: z.string(),
      phone: z.string(),
      addressMailing: z.object({
        address1: z.string(),
        city: z.string(),
        state: z.string(),
        postalCode: z.string(),
        country: z.string().describe("Two-letter country code"),
      }),
    }).describe("Registrant contact info"),
  },
  async ({ domain, agreedAt, agreedBy, agreementKeys, contactRegistrant, ...rest }) => {
    const result = await gd.purchaseDomain({
      domain,
      consent: { agreedAt, agreedBy, agreementKeys },
      contactRegistrant,
      contactAdmin: contactRegistrant,
      contactBilling: contactRegistrant,
      contactTech: contactRegistrant,
      ...rest,
    });
    return json(result);
  }
);

// ─── Renew Domain ────────────────────────────────────────────────
server.tool(
  "renew_domain",
  "Renew a domain registration for an additional period.",
  {
    domain: z.string().describe("Domain to renew"),
    period: z.number().optional().describe("Renewal period in years (default 1)"),
  },
  async ({ domain, period }) => json(await gd.renewDomain(domain, period))
);

// ─── Transfer Domain ─────────────────────────────────────────────
server.tool(
  "transfer_domain",
  "Initiate a domain transfer into GoDaddy.",
  {
    domain: z.string().describe("Domain to transfer"),
    authCode: z.string().describe("Authorization/EPP code from current registrar"),
    agreedAt: z.string().describe("ISO 8601 timestamp of agreement"),
    agreedBy: z.string().describe("IP address of the agreeing party"),
    agreementKeys: z.array(z.string()).describe("Agreement keys from get_agreements"),
    period: z.number().optional().describe("Registration period in years"),
  },
  async ({ domain, authCode, agreedAt, agreedBy, agreementKeys, period }) => {
    const result = await gd.transferDomain(domain, {
      authCode,
      consent: { agreedAt, agreedBy, agreementKeys },
      period,
    });
    return json(result);
  }
);

// ─── Get DNS Records ─────────────────────────────────────────────
server.tool(
  "get_dns_records",
  "Retrieve DNS records for a domain. Optionally filter by type and name.",
  {
    domain: z.string().describe("Domain name"),
    type: z.enum(["A", "AAAA", "CNAME", "MX", "NS", "SOA", "SRV", "TXT", "CAA"]).optional().describe("Record type filter"),
    name: z.string().optional().describe("Record name filter (e.g. 'www', '@')"),
    limit: z.number().optional().describe("Max records to return"),
    offset: z.number().optional().describe("Offset for pagination"),
  },
  async ({ domain, type, name, limit, offset }) => {
    const result = await gd.getDnsRecords(domain, type, name, { limit, offset });
    return json(result);
  }
);

// ─── Add DNS Records ─────────────────────────────────────────────
server.tool(
  "add_dns_records",
  "Add new DNS records to a domain without removing existing ones.",
  {
    domain: z.string().describe("Domain name"),
    records: z.array(z.object({
      type: z.enum(["A", "AAAA", "CNAME", "MX", "NS", "SRV", "TXT", "CAA"]).describe("Record type"),
      name: z.string().describe("Record name (use '@' for root)"),
      data: z.string().describe("Record value"),
      ttl: z.number().optional().describe("TTL in seconds (default 3600)"),
      priority: z.number().optional().describe("Priority (required for MX and SRV)"),
    })).describe("DNS records to add"),
  },
  async ({ domain, records }) => json(await gd.addDnsRecords(domain, records))
);

// ─── Replace DNS Records ─────────────────────────────────────────
server.tool(
  "replace_dns_records",
  "Replace DNS records for a domain. Can replace all records, by type, or by type+name.",
  {
    domain: z.string().describe("Domain name"),
    type: z.enum(["A", "AAAA", "CNAME", "MX", "NS", "SRV", "TXT", "CAA"]).optional().describe("Replace only records of this type"),
    name: z.string().optional().describe("Replace only records with this name (requires type)"),
    records: z.array(z.object({
      type: z.enum(["A", "AAAA", "CNAME", "MX", "NS", "SRV", "TXT", "CAA"]).optional().describe("Record type (required when replacing all)"),
      name: z.string().optional().describe("Record name (required when replacing all or by type)"),
      data: z.string().describe("Record value"),
      ttl: z.number().optional().describe("TTL in seconds"),
      priority: z.number().optional().describe("Priority (for MX/SRV)"),
    })).describe("Replacement records"),
  },
  async ({ domain, type, name, records }) => {
    if (type && name) {
      return json(await gd.replaceDnsRecordsByTypeName(domain, type, name, records));
    } else if (type) {
      return json(await gd.replaceDnsRecordsByType(domain, type, records as any));
    } else {
      return json(await gd.replaceAllDnsRecords(domain, records as any));
    }
  }
);

// ─── Delete DNS Records ──────────────────────────────────────────
server.tool(
  "delete_dns_records",
  "Delete DNS records by replacing a type+name combination with an empty set.",
  {
    domain: z.string().describe("Domain name"),
    type: z.enum(["A", "AAAA", "CNAME", "MX", "NS", "SRV", "TXT", "CAA"]).describe("Record type to delete"),
    name: z.string().describe("Record name to delete (use '@' for root)"),
  },
  async ({ domain, type, name }) => {
    return json(await gd.replaceDnsRecordsByTypeName(domain, type, name, []));
  }
);

// ─── Update Domain Contacts ──────────────────────────────────────
const contactSchema = z.object({
  nameFirst: z.string(),
  nameLast: z.string(),
  email: z.string(),
  phone: z.string(),
  organization: z.string().optional(),
  addressMailing: z.object({
    address1: z.string(),
    address2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string().describe("Two-letter country code"),
  }),
}).optional();

server.tool(
  "update_contacts",
  "Update contact information for a domain (admin, billing, registrant, tech).",
  {
    domain: z.string().describe("Domain name"),
    contactAdmin: contactSchema.describe("Admin contact"),
    contactBilling: contactSchema.describe("Billing contact"),
    contactRegistrant: contactSchema.describe("Registrant contact"),
    contactTech: contactSchema.describe("Technical contact"),
  },
  async ({ domain, ...contacts }) => json(await gd.updateContacts(domain, contacts))
);

// ─── Purchase Privacy ────────────────────────────────────────────
server.tool(
  "purchase_privacy",
  "Purchase WHOIS privacy protection for a domain.",
  {
    domain: z.string().describe("Domain name"),
    agreedAt: z.string().describe("ISO 8601 timestamp of agreement"),
    agreedBy: z.string().describe("IP address of the agreeing party"),
    agreementKeys: z.array(z.string()).describe("Agreement keys"),
  },
  async ({ domain, agreedAt, agreedBy, agreementKeys }) => {
    return json(await gd.purchasePrivacy(domain, { agreedAt, agreedBy, agreementKeys }));
  }
);

// ─── Cancel Privacy ──────────────────────────────────────────────
server.tool(
  "cancel_privacy",
  "Cancel WHOIS privacy protection for a domain.",
  { domain: z.string().describe("Domain name") },
  async ({ domain }) => json(await gd.cancelPrivacy(domain))
);

// ─── Verify Registrant Email ─────────────────────────────────────
server.tool(
  "verify_registrant_email",
  "Re-send the registrant email verification for a domain.",
  { domain: z.string().describe("Domain name") },
  async ({ domain }) => json(await gd.verifyRegistrantEmail(domain))
);

// ─── Get TLDs ────────────────────────────────────────────────────
server.tool(
  "get_tlds",
  "List all top-level domains (TLDs) available for registration.",
  {},
  async () => json(await gd.getTlds())
);

// ─── Get Agreements ──────────────────────────────────────────────
server.tool(
  "get_agreements",
  "Retrieve legal agreements required for domain purchase or transfer.",
  {
    tlds: z.array(z.string()).describe("TLDs to get agreements for (e.g. ['com', 'net'])"),
    privacy: z.boolean().describe("Include privacy agreement"),
    forTransfer: z.boolean().optional().describe("Get transfer agreements instead of registration"),
  },
  async ({ tlds, privacy, forTransfer }) => json(await gd.getAgreements(tlds, privacy, forTransfer))
);

// ── Start ────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GoDaddy MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
