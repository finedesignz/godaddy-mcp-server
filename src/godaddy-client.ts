const BASE_URLS: Record<string, string> = {
  production: "https://api.godaddy.com",
  ote: "https://api.ote-godaddy.com",
};

export interface GoDaddyClientConfig {
  apiKey: string;
  apiSecret: string;
  env?: "production" | "ote";
}

export class GoDaddyClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: GoDaddyClientConfig) {
    this.baseUrl = BASE_URLS[config.env || "production"];
    this.authHeader = `sso-key ${config.apiKey}:${config.apiSecret}`;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<unknown> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
        )
      );
      const str = qs.toString();
      if (str) url += `?${str}`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      let detail: string;
      try {
        const json = JSON.parse(text);
        detail = json.message || json.code || text;
      } catch {
        detail = text;
      }
      throw new Error(`GoDaddy API ${res.status}: ${detail}`);
    }

    if (res.status === 204) return { success: true };

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return { success: true };
  }

  // ── Domain listing & details ───────────────────────────────────

  async listDomains(opts?: {
    statuses?: string;
    limit?: number;
    marker?: string;
  }) {
    const params: Record<string, string> = {};
    if (opts?.statuses) params.statuses = opts.statuses;
    if (opts?.limit) params.limit = String(opts.limit);
    if (opts?.marker) params.marker = opts.marker;
    return this.request("GET", "/v1/domains", undefined, params);
  }

  async getDomain(domain: string) {
    return this.request("GET", `/v1/domains/${encodeURIComponent(domain)}`);
  }

  async updateDomain(
    domain: string,
    update: {
      locked?: boolean;
      nameServers?: string[];
      renewAuto?: boolean;
      subaccountId?: string;
    }
  ) {
    return this.request(
      "PATCH",
      `/v1/domains/${encodeURIComponent(domain)}`,
      update
    );
  }

  async cancelDomain(domain: string) {
    return this.request(
      "DELETE",
      `/v1/domains/${encodeURIComponent(domain)}`
    );
  }

  // ── Availability & purchase ────────────────────────────────────

  async checkAvailability(domain: string, checkType?: string) {
    const params: Record<string, string> = { domain };
    if (checkType) params.checkType = checkType;
    return this.request("GET", "/v1/domains/available", undefined, params);
  }

  async purchaseDomain(purchase: {
    domain: string;
    consent: { agreedAt: string; agreedBy: string; agreementKeys: string[] };
    contactAdmin?: unknown;
    contactBilling?: unknown;
    contactRegistrant?: unknown;
    contactTech?: unknown;
    nameServers?: string[];
    period?: number;
    privacy?: boolean;
    renewAuto?: boolean;
  }) {
    return this.request("POST", "/v1/domains/purchase", purchase);
  }

  async renewDomain(domain: string, period?: number) {
    return this.request(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/renew`,
      period ? { period } : undefined
    );
  }

  async transferDomain(
    domain: string,
    transfer: { authCode: string; consent: unknown; period?: number }
  ) {
    return this.request(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/transfer`,
      transfer
    );
  }

  // ── DNS records ────────────────────────────────────────────────

  async getDnsRecords(
    domain: string,
    type?: string,
    name?: string,
    opts?: { offset?: number; limit?: number }
  ) {
    let path = `/v1/domains/${encodeURIComponent(domain)}/records`;
    if (type) {
      path += `/${encodeURIComponent(type)}`;
      if (name) path += `/${encodeURIComponent(name)}`;
    }
    const params: Record<string, string> = {};
    if (opts?.offset !== undefined) params.offset = String(opts.offset);
    if (opts?.limit !== undefined) params.limit = String(opts.limit);
    return this.request("GET", path, undefined, params);
  }

  async addDnsRecords(
    domain: string,
    records: Array<{
      type: string;
      name: string;
      data: string;
      ttl?: number;
      priority?: number;
    }>
  ) {
    return this.request(
      "PATCH",
      `/v1/domains/${encodeURIComponent(domain)}/records`,
      records
    );
  }

  async replaceDnsRecordsByTypeName(
    domain: string,
    type: string,
    name: string,
    records: Array<{ data: string; ttl?: number; priority?: number }>
  ) {
    return this.request(
      "PUT",
      `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
      records
    );
  }

  async replaceDnsRecordsByType(
    domain: string,
    type: string,
    records: Array<{
      name: string;
      data: string;
      ttl?: number;
      priority?: number;
    }>
  ) {
    return this.request(
      "PUT",
      `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}`,
      records
    );
  }

  async replaceAllDnsRecords(
    domain: string,
    records: Array<{
      type: string;
      name: string;
      data: string;
      ttl?: number;
      priority?: number;
    }>
  ) {
    return this.request(
      "PUT",
      `/v1/domains/${encodeURIComponent(domain)}/records`,
      records
    );
  }

  // ── Contacts & privacy ────────────────────────────────────────

  async updateContacts(
    domain: string,
    contacts: {
      contactAdmin?: unknown;
      contactBilling?: unknown;
      contactRegistrant?: unknown;
      contactTech?: unknown;
    }
  ) {
    return this.request(
      "PATCH",
      `/v1/domains/${encodeURIComponent(domain)}/contacts`,
      contacts
    );
  }

  async purchasePrivacy(domain: string, consent: { agreedAt: string; agreedBy: string; agreementKeys: string[] }) {
    return this.request(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/privacy/purchase`,
      { consent }
    );
  }

  async cancelPrivacy(domain: string) {
    return this.request(
      "DELETE",
      `/v1/domains/${encodeURIComponent(domain)}/privacy`
    );
  }

  // ── Utilities ──────────────────────────────────────────────────

  async verifyRegistrantEmail(domain: string) {
    return this.request(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/verifyRegistrantEmail`
    );
  }

  async getTlds() {
    return this.request("GET", "/v1/domains/tlds");
  }

  async getAgreements(tlds: string[], privacy: boolean, forTransfer?: boolean) {
    const params: Record<string, string> = {
      tlds: tlds.join(","),
      privacy: String(privacy),
    };
    if (forTransfer !== undefined) params.forTransfer = String(forTransfer);
    return this.request("GET", "/v1/domains/agreements", undefined, params);
  }
}
