import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GoDaddyClient } from "./godaddy-client.js";

// ── Helper ───────────────────────────────────────────────────────
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

// ── MCP Server Factory ──────────────────────────────────────────
// Each session gets its own server instance with its own credentials.
function createServer() {
  const server = new McpServer({
    name: "godaddy",
    version: "1.0.0",
  });

  // Session-scoped credential state
  let gd: GoDaddyClient | null = null;

  function requireClient(): GoDaddyClient {
    if (!gd) throw new Error("NOT_CONFIGURED");
    return gd;
  }

  // ─── Set Credentials (must be called first) ──────────────────────
  server.tool(
    "set_credentials",
    "Set GoDaddy API credentials for this session. Must be called before any other tool.",
    {
      apiKey: z.string().describe("GoDaddy API key"),
      apiSecret: z.string().describe("GoDaddy API secret"),
      env: z.enum(["production", "ote"]).optional().describe("API environment (default: production)"),
    },
    async ({ apiKey, apiSecret, env }) => {
      gd = new GoDaddyClient({ apiKey, apiSecret, env: env || "production" });
      return json({ status: "ok", message: "Credentials set. You can now use all GoDaddy tools." });
    }
  );

  // ── Wrap tool handlers to check credentials ────────────────────
  function authed<T>(fn: (client: GoDaddyClient, args: T) => Promise<any>) {
    return async (args: T) => {
      try {
        const client = requireClient();
        return await fn(client, args);
      } catch (err: any) {
        if (err.message === "NOT_CONFIGURED") {
          return errorResult("Credentials not set. Call set_credentials first with your GoDaddy API key and secret.");
        }
        throw err;
      }
    };
  }

  // ─── List Domains ────────────────────────────────────────────────
  server.tool(
    "list_domains",
    "List all domains in the GoDaddy account. Optionally filter by status.",
    {
      statuses: z.string().optional().describe("Comma-separated statuses: ACTIVE, CANCELLED, etc."),
      limit: z.number().optional().describe("Max results to return (default 100)"),
      marker: z.string().optional().describe("Marker for pagination"),
    },
    authed(async (client, { statuses, limit, marker }) => {
      return json(await client.listDomains({ statuses, limit, marker }));
    })
  );

  // ─── Get Domain Details ──────────────────────────────────────────
  server.tool(
    "get_domain",
    "Get detailed information about a specific domain including status, nameservers, contacts, and expiration.",
    { domain: z.string().describe("Domain name (e.g. example.com)") },
    authed(async (client, { domain }) => json(await client.getDomain(domain)))
  );

  // ─── Check Domain Availability ───────────────────────────────────
  server.tool(
    "check_availability",
    "Check if a domain name is available for purchase.",
    {
      domain: z.string().describe("Domain to check (e.g. example.com)"),
      checkType: z.enum(["FAST", "FULL"]).optional().describe("FAST for quick check, FULL for detailed pricing"),
    },
    authed(async (client, { domain, checkType }) => json(await client.checkAvailability(domain, checkType)))
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
    authed(async (client, { domain, ...update }) => json(await client.updateDomain(domain, update)))
  );

  // ─── Cancel Domain ───────────────────────────────────────────────
  server.tool(
    "cancel_domain",
    "Cancel a purchased domain registration.",
    { domain: z.string().describe("Domain name to cancel") },
    authed(async (client, { domain }) => json(await client.cancelDomain(domain)))
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
    authed(async (client, { domain, agreedAt, agreedBy, agreementKeys, contactRegistrant, ...rest }) => {
      const result = await client.purchaseDomain({
        domain,
        consent: { agreedAt, agreedBy, agreementKeys },
        contactRegistrant,
        contactAdmin: contactRegistrant,
        contactBilling: contactRegistrant,
        contactTech: contactRegistrant,
        ...rest,
      });
      return json(result);
    })
  );

  // ─── Renew Domain ────────────────────────────────────────────────
  server.tool(
    "renew_domain",
    "Renew a domain registration for an additional period.",
    {
      domain: z.string().describe("Domain to renew"),
      period: z.number().optional().describe("Renewal period in years (default 1)"),
    },
    authed(async (client, { domain, period }) => json(await client.renewDomain(domain, period)))
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
    authed(async (client, { domain, authCode, agreedAt, agreedBy, agreementKeys, period }) => {
      const result = await client.transferDomain(domain, {
        authCode,
        consent: { agreedAt, agreedBy, agreementKeys },
        period,
      });
      return json(result);
    })
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
    authed(async (client, { domain, type, name, limit, offset }) => {
      return json(await client.getDnsRecords(domain, type, name, { limit, offset }));
    })
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
    authed(async (client, { domain, records }) => json(await client.addDnsRecords(domain, records)))
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
    authed(async (client, { domain, type, name, records }) => {
      if (type && name) {
        return json(await client.replaceDnsRecordsByTypeName(domain, type, name, records));
      } else if (type) {
        return json(await client.replaceDnsRecordsByType(domain, type, records as any));
      } else {
        return json(await client.replaceAllDnsRecords(domain, records as any));
      }
    })
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
    authed(async (client, { domain, type, name }) => {
      return json(await client.replaceDnsRecordsByTypeName(domain, type, name, []));
    })
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
    authed(async (client, { domain, ...contacts }) => json(await client.updateContacts(domain, contacts)))
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
    authed(async (client, { domain, agreedAt, agreedBy, agreementKeys }) => {
      return json(await client.purchasePrivacy(domain, { agreedAt, agreedBy, agreementKeys }));
    })
  );

  // ─── Cancel Privacy ──────────────────────────────────────────────
  server.tool(
    "cancel_privacy",
    "Cancel WHOIS privacy protection for a domain.",
    { domain: z.string().describe("Domain name") },
    authed(async (client, { domain }) => json(await client.cancelPrivacy(domain)))
  );

  // ─── Verify Registrant Email ─────────────────────────────────────
  server.tool(
    "verify_registrant_email",
    "Re-send the registrant email verification for a domain.",
    { domain: z.string().describe("Domain name") },
    authed(async (client, { domain }) => json(await client.verifyRegistrantEmail(domain)))
  );

  // ─── Get TLDs ────────────────────────────────────────────────────
  server.tool(
    "get_tlds",
    "List all top-level domains (TLDs) available for registration.",
    {},
    authed(async (client) => json(await client.getTlds()))
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
    authed(async (client, { tlds, privacy, forTransfer }) => json(await client.getAgreements(tlds, privacy, forTransfer)))
  );

  return server;
}

// ── Start ────────────────────────────────────────────────────────
async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

  if (port) {
    // HTTP mode for Coolify/Docker deployment
    const app = express();

    const transports = new Map<string, StreamableHTTPServerTransport>();

    app.post("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      const server = createServer();
      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
      }
    });

    app.get("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }
      res.status(400).json({ error: "No valid session. Send an initialize request first." });
    });

    app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }
      res.status(400).json({ error: "No valid session." });
    });

    app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });

    app.listen(port, "0.0.0.0", () => {
      console.log(`GoDaddy MCP server listening on http://0.0.0.0:${port}/mcp`);
    });
  } else {
    // stdio mode for local MCP clients
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("GoDaddy MCP server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
