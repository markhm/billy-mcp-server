#!/usr/bin/env node

/**
 * Billy MCP Server
 *
 * Exposes Billy's accounting API (v2) as MCP tools over stdio.
 * Docs: https://www.billy.dk/api/
 */

import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios, { AxiosResponse } from "axios";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load a .env file if one exists, so the token can live in .env rather than being
 * exported by hand. Real environment variables always take precedence, so an MCP
 * client's `env` block is never shadowed by a stale .env.
 *
 * Looks next to the package (where .env.example lives) and in the working
 * directory, since MCP clients spawn the server with an arbitrary cwd.
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== "function") return; // Node < 20.12
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (const candidate of new Set([resolve(packageRoot, ".env"), resolve(process.cwd(), ".env")])) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // Absent or unreadable; environment variables remain the primary source.
    }
  }
}

loadDotEnv();

const API_BASE_URL = process.env.BILLY_API_BASE_URL ?? "https://api.billysbilling.com/v2";
const SERVER_VERSION = "2.1.0";

const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * Writes are opt-in. Billy has no scoped or read-only access tokens and no read-only
 * user role, so every token can write and this server is the only place the
 * restriction can be enforced. It defaults to refusing, and enforces that twice:
 * mutating tools are not registered at all, and BillyClient refuses any non-GET
 * request. Set BILLY_ALLOW_WRITES=true to enable the mutating tools.
 */
const ALLOW_WRITES = TRUTHY.test(process.env.BILLY_ALLOW_WRITES?.trim() ?? "");
const READ_ONLY = !ALLOW_WRITES;

// BILLY_READ_ONLY was the opt-in flag before writes became opt-out. Setting it no
// longer does anything, and `BILLY_READ_ONLY=false` no longer enables writes.
if (process.env.BILLY_READ_ONLY !== undefined) {
  console.error(
    "Warning: BILLY_READ_ONLY is no longer used. Read-only is now the default; " +
      "set BILLY_ALLOW_WRITES=true to enable the mutating tools."
  );
}

interface BillyConfig {
  accessToken: string;
  organizationId?: string;
  readOnly?: boolean;
  /** Capture non-GET requests instead of sending them. GETs still run, so a dry
   *  run can resolve accounts and validate against live data. */
  dryRun?: boolean;
}

/** Hard cap on auto-paginated fetches, so a broad query cannot blow up the response. */
const MAX_PAGE_SIZE = 1000;
const MAX_RECORDS = 5000;

/**
 * Billy's date-range filter. Verified to work on /invoices, /bills and /postings;
 * it is SILENTLY IGNORED on /daybookTransactions and /salesTaxReturns, which return
 * the full set instead of erroring, so those are filtered client-side below.
 */
function entryDatePeriodParam(fromDate?: string, toDate?: string): Record<string, string> {
  if (!fromDate && !toDate) return {};
  return { entryDatePeriod: `dates:${fromDate ?? "1900-01-01"}...${toDate ?? "2999-12-31"}` };
}

/** Inclusive ISO date-range test. ISO-8601 dates compare correctly as strings. */
function withinRange(date: unknown, fromDate?: string, toDate?: string): boolean {
  if (typeof date !== "string") return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

/** Serialise query params, skipping absent values and coercing booleans/numbers. */
function toQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

class BillyClient {
  private readonly accessToken: string;
  private readonly organizationId?: string;
  private readonly readOnly: boolean;
  private readonly dryRun: boolean;

  constructor(private readonly config: BillyConfig) {
    this.accessToken = config.accessToken;
    this.organizationId = config.organizationId;
    this.readOnly = config.readOnly ?? false;
    this.dryRun = config.dryRun ?? false;
  }

  /** A client that reads normally but returns writes as a description instead of sending them. */
  withDryRun(): BillyClient {
    return new BillyClient({ ...this.config, dryRun: true });
  }

  private async request(method: string, endpoint: string, data?: unknown): Promise<any> {
    // Backstop for read-only mode: catches any future write path that slips past
    // tool registration.
    if (this.readOnly && method.toUpperCase() !== "GET") {
      throw new Error(
        `Refusing ${method.toUpperCase()} ${endpoint}: this server is read-only. ` +
          `Set BILLY_ALLOW_WRITES=true to enable write access.`
      );
    }

    if (this.dryRun && method.toUpperCase() !== "GET") {
      return { dryRun: true, request: { method: method.toUpperCase(), endpoint, body: data ?? null } };
    }

    try {
      const response: AxiosResponse = await axios({
        method,
        url: `${API_BASE_URL}${endpoint}`,
        headers: {
          "X-Access-Token": this.accessToken,
          "Content-Type": "application/json",
        },
        data,
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Billy API Error${error.response ? ` ${error.response.status}` : ""}: ${describeErrorBody(error.response?.data) ?? error.message}`);
      }
      throw error;
    }
  }

  /** Billy tokens are organisation-scoped, so organizationId is normally inferred.
   *  It is sent explicitly only when BILLY_ORGANIZATION_ID is configured. */
  private scoped(body: Record<string, unknown>): Record<string, unknown> {
    return this.organizationId ? { organizationId: this.organizationId, ...body } : body;
  }

  getOrganization(): Promise<any> {
    return this.request("GET", "/organization");
  }

  getContacts(params?: Record<string, unknown>): Promise<any> {
    return this.request("GET", `/contacts${toQuery(params)}`);
  }

  getContact(id: string, include?: string): Promise<any> {
    return this.request("GET", `/contacts/${encodeURIComponent(id)}${toQuery({ include })}`);
  }

  createContact(contact: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/contacts", { contact: this.scoped(contact) });
  }

  updateContact(id: string, contact: Record<string, unknown>): Promise<any> {
    return this.request("PUT", `/contacts/${encodeURIComponent(id)}`, { contact });
  }

  getInvoices(params: Record<string, any> = {}): Promise<any> {
    const { fromDate, toDate, ...rest } = params;
    return this.request("GET", `/invoices${toQuery({ ...rest, ...entryDatePeriodParam(fromDate, toDate) })}`);
  }

  getInvoice(id: string, include?: string): Promise<any> {
    return this.request("GET", `/invoices/${encodeURIComponent(id)}${toQuery({ include })}`);
  }

  createInvoice(invoice: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/invoices", { invoice: this.scoped(invoice) });
  }

  updateInvoice(id: string, invoice: Record<string, unknown>): Promise<any> {
    return this.request("PUT", `/invoices/${encodeURIComponent(id)}`, { invoice });
  }

  getProducts(params?: Record<string, unknown>): Promise<any> {
    return this.request("GET", `/products${toQuery(params)}`);
  }

  getProduct(id: string, include?: string): Promise<any> {
    return this.request("GET", `/products/${encodeURIComponent(id)}${toQuery({ include })}`);
  }

  createProduct(product: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/products", { product: this.scoped(product) });
  }

  getBankPayments(params?: Record<string, unknown>): Promise<any> {
    return this.request("GET", `/bankPayments${toQuery(params)}`);
  }

  createBankPayment(bankPayment: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/bankPayments", { bankPayment: this.scoped(bankPayment) });
  }

  getBills(params: Record<string, any> = {}): Promise<any> {
    const { fromDate, toDate, ...rest } = params;
    return this.request("GET", `/bills${toQuery({ ...rest, ...entryDatePeriodParam(fromDate, toDate) })}`);
  }

  createBill(bill: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/bills", { bill: this.scoped(bill) });
  }

  getAccounts(params?: Record<string, unknown>): Promise<any> {
    return this.request("GET", `/accounts${toQuery(params)}`);
  }

  getAllAccounts(): Promise<any> {
    return this.getAllPages("/accounts", "accounts");
  }

  getDaybooks(): Promise<any> {
    return this.getAllPages("/daybooks", "daybooks");
  }

  getDaybookTransaction(id: string): Promise<any> {
    return this.request("GET", `/daybookTransactions/${encodeURIComponent(id)}${toQuery({ include: "daybookTransaction.lines" })}`);
  }

  createDaybookTransaction(transaction: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/daybookTransactions", { daybookTransaction: this.scoped(transaction) });
  }

  deleteDaybookTransaction(id: string): Promise<any> {
    return this.request("DELETE", `/daybookTransactions/${encodeURIComponent(id)}`);
  }

  /**
   * Fetches every page of a list endpoint, up to MAX_RECORDS. Partial data silently
   * produces wrong totals, so the result reports exactly what was retrieved and flags
   * truncation rather than quietly returning a slice.
   */
  private async getAllPages(path: string, key: string, params: Record<string, unknown> = {}): Promise<any> {
    const items: any[] = [];
    let meta: any = null;
    let page = 1;
    let truncated = false;

    for (;;) {
      const res = await this.request("GET", `${path}${toQuery({ ...params, page, pageSize: MAX_PAGE_SIZE })}`);
      meta = res.meta;
      items.push(...(res[key] ?? []));

      const paging = res.meta?.paging;
      if (!paging?.pageCount || page >= paging.pageCount) break;
      if (items.length >= MAX_RECORDS) {
        truncated = true;
        break;
      }
      page += 1;
    }

    return { meta, [key]: items, retrieved: items.length, truncated };
  }

  /** VAT returns. Billy ignores date filters here, so the period overlap is applied locally. */
  async getSalesTaxReturns(params: Record<string, any> = {}): Promise<any> {
    const { fromDate, toDate } = params;
    const res = await this.getAllPages("/salesTaxReturns", "salesTaxReturns");
    const filtered = (res.salesTaxReturns as any[]).filter(
      (r) => (!toDate || r.startDate <= toDate) && (!fromDate || r.endDate >= fromDate)
    );
    return { ...res, salesTaxReturns: filtered, retrieved: filtered.length };
  }

  getSalesTaxReturn(id: string): Promise<any> {
    return this.request("GET", `/salesTaxReturns/${encodeURIComponent(id)}`);
  }

  /**
   * Ledger postings. entryDatePeriod and accountId are honoured by the API;
   * taxRateId and salesTaxReturnId are NOT (verified — they return the full set),
   * so they are applied client-side after the server-side narrowing.
   */
  async getPostings(params: Record<string, any> = {}): Promise<any> {
    const { fromDate, toDate, accountId, taxRateId, salesTaxReturnId } = params;
    const res = await this.getAllPages("/postings", "postings", {
      ...entryDatePeriodParam(fromDate, toDate),
      ...(accountId ? { accountId } : {}),
    });
    let postings = res.postings as any[];
    if (taxRateId) postings = postings.filter((p) => p.taxRateId === taxRateId);
    if (salesTaxReturnId) postings = postings.filter((p) => p.salesTaxReturnId === salesTaxReturnId);
    return { ...res, postings, retrieved: postings.length };
  }

  /** Manual journal entries. Billy ignores date filters here, so it is applied locally. */
  async getDaybookTransactions(params: Record<string, any> = {}): Promise<any> {
    const { fromDate, toDate, state } = params;
    const res = await this.getAllPages("/daybookTransactions", "daybookTransactions");
    let rows = res.daybookTransactions as any[];
    if (fromDate || toDate) rows = rows.filter((t) => withinRange(t.entryDate, fromDate, toDate));
    if (state) rows = rows.filter((t) => t.state === state);
    return { ...res, daybookTransactions: rows, retrieved: rows.length };
  }

  async getTaxRates(params: Record<string, any> = {}): Promise<any> {
    const { appliesToSales, appliesToPurchases, isActive } = params;
    const res = await this.getAllPages("/taxRates", "taxRates");
    let rates = res.taxRates as any[];
    if (appliesToSales !== undefined) rates = rates.filter((r) => r.appliesToSales === appliesToSales);
    if (appliesToPurchases !== undefined) rates = rates.filter((r) => r.appliesToPurchases === appliesToPurchases);
    if (isActive !== undefined) rates = rates.filter((r) => r.isActive === isActive);
    return { ...res, taxRates: rates, retrieved: rates.length };
  }

  getAccountGroups(): Promise<any> {
    return this.getAllPages("/accountGroups", "accountGroups");
  }
}

/**
 * Billy errors carry {errorMessage, errorCode}. The API sometimes prefixes the
 * body with a plain-text line (e.g. "LOGGER ERROR: ..."), which leaves axios
 * holding an unparsed string, so recover the JSON object embedded in it.
 */
function describeErrorBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;

  if (typeof body === "string") {
    const embedded = body.slice(body.indexOf("{"));
    if (embedded) {
      try {
        return describeErrorBody(JSON.parse(embedded));
      } catch {
        // Not JSON after all; fall through to the raw string.
      }
    }
    return body.trim();
  }

  if (typeof body === "object") {
    const { errorMessage, errorCode } = body as { errorMessage?: string; errorCode?: string };
    if (errorMessage) return errorCode ? `${errorMessage} (${errorCode})` : errorMessage;
    return JSON.stringify(body);
  }

  return String(body);
}

let billyClient: BillyClient | null = null;

function getBillyClient(): BillyClient {
  if (!billyClient) {
    const accessToken = process.env.BILLY_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error(
        "BILLY_ACCESS_TOKEN is not set. Create a token in Billy under Settings -> Access tokens, " +
          "then put it in your MCP client's env block or in a .env file next to the server."
      );
    }
    billyClient = new BillyClient({
      accessToken,
      organizationId: process.env.BILLY_ORGANIZATION_ID,
      readOnly: READ_ONLY,
    });
  }
  return billyClient;
}

// --- Shared schema fragments -------------------------------------------------

const listParams = {
  page: z.number().int().min(0).optional().describe("Page number for pagination"),
  pageSize: z.number().int().min(1).max(1000).optional().describe("Number of items per page (max 1000)"),
  sortProperty: z.string().optional().describe("Property to sort by"),
  sortDirection: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
};

const includeParam = z.string().optional();

/** Date-range filter on entryDate (bogføringsdato). Format is validated so a malformed
 *  date fails here rather than silently widening the period. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateRangeParams = {
  fromDate: z
    .string()
    .regex(ISO_DATE, "must be YYYY-MM-DD")
    .optional()
    .describe("Start of the entryDate range, inclusive (YYYY-MM-DD)"),
  toDate: z
    .string()
    .regex(ISO_DATE, "must be YYYY-MM-DD")
    .optional()
    .describe("End of the entryDate range, inclusive (YYYY-MM-DD)"),
};

/** Extra keys the auto-paginating tools return so callers can trust completeness. */
const completeness = {
  retrieved: z.number().optional().describe("Number of records actually returned after filtering"),
  truncated: z
    .boolean()
    .optional()
    .describe("True if the record cap was hit and results are incomplete — narrow the filters"),
};

/** Billy entities vary by organisation configuration, so entity bodies stay open.
 *  Every key is optional: the schema documents the envelope without risking a
 *  validation failure on a response shape we have not pinned down. */
const billyEntity = z.looseObject({});

/** Billy's response metadata. Verified against the live API; `paging` is present
 *  on list endpoints only. Stays open to unknown keys. */
const billyMeta = z.looseObject({
  statusCode: z.number().optional(),
  success: z.boolean().optional(),
  paging: z
    .looseObject({
      page: z.number().optional(),
      pageSize: z.number().optional(),
      pageCount: z.number().optional().describe("Total number of pages"),
      total: z.number().optional().describe("Total number of matching records"),
      nextUrl: z.string().optional(),
      lastUrl: z.string().optional(),
    })
    .optional()
    .describe("Pagination info; use `total`/`pageCount` to decide whether to page further"),
});

/**
 * Envelope returned by Billy list/read endpoints: {meta, <resourceKey>}.
 *
 * `include` causes Billy to return the related records as extra sibling keys
 * (e.g. include=invoice.lines adds `invoiceLines`), so those are declared too.
 */
function billyEnvelope(resourceKey: string, kind: "list" | "single", sideloads: string[] = []) {
  return {
    meta: billyMeta.optional().describe("Billy response metadata (status, paging)"),
    [resourceKey]: (kind === "list" ? z.array(billyEntity) : billyEntity)
      .optional()
      .describe(`The ${resourceKey} returned by Billy`),
    ...Object.fromEntries(
      sideloads.map((key) => [
        key,
        z.array(billyEntity).optional().describe(`Related ${key}, present when requested via \`include\``),
      ])
    ),
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
const creates = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const updates = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

/**
 * Every write tool dry-runs by default: the request is returned, not sent. A write
 * therefore takes two deliberate calls — review, then repeat with dryRun: false —
 * on top of the BILLY_ALLOW_WRITES opt-in that exposes the tools at all.
 */
const dryRunParam = {
  dryRun: z
    .boolean()
    .default(true)
    .describe("Default true: return the exact request without sending it. Set false only after the dry run was reviewed."),
};

const dryRunOutput = {
  dryRun: z.boolean().optional().describe("True when nothing was sent to Billy"),
  request: z.looseObject({}).optional().describe("The request that would be sent (dry run only)"),
  preview: z.looseObject({}).optional().describe("Human-readable summary of the change, where the tool provides one"),
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Runs a Billy call, returning the payload as both text and structured content.
 *  With `dryRun`, writes are described rather than sent (see BillyClient.withDryRun). */
async function call(fn: (client: BillyClient) => Promise<any>, dryRun = false): Promise<ToolResult> {
  try {
    const client = getBillyClient();
    const data = await fn(dryRun ? client.withDryRun() : client);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: (data ?? {}) as Record<string, unknown>,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

const server = new McpServer({ name: "billy-mcp-server", version: SERVER_VERSION });

/** Mutating tools, tracked so they can be unregistered unless writes are enabled. */
const writeTools: RegisteredTool[] = [];

// --- Organization ------------------------------------------------------------

server.registerTool(
  "billy_get_organization",
  {
    title: "Get organization",
    description: "Get organization details from Billy",
    inputSchema: {},
    outputSchema: billyEnvelope("organization", "single"),
    annotations: readOnly,
  },
  () => call((billy) => billy.getOrganization())
);

// --- Contacts ----------------------------------------------------------------

server.registerTool(
  "billy_list_contacts",
  {
    title: "List contacts",
    description: "List contacts with optional filtering and pagination",
    inputSchema: {
      ...listParams,
      isCustomer: z.boolean().optional().describe("Filter by customer status"),
      isSupplier: z.boolean().optional().describe("Filter by supplier status"),
      include: includeParam.describe("Related resources to include"),
    },
    outputSchema: billyEnvelope("contacts", "list"),
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getContacts(args))
);

server.registerTool(
  "billy_get_contact",
  {
    title: "Get contact",
    description: "Get a specific contact by ID",
    inputSchema: {
      id: z.string().describe("Contact ID"),
      include: includeParam.describe("Related resources to include (e.g. 'contact.contactPersons')"),
    },
    outputSchema: billyEnvelope("contact", "single", ["contactPersons"]),
    annotations: readOnly,
  },
  ({ id, include }) => call((billy) => billy.getContact(id, include))
);

const contactFields = {
  name: z.string().optional().describe("Contact name"),
  street: z.string().optional().describe("Street address"),
  city: z.string().optional().describe("City"),
  zipcode: z.string().optional().describe("Zipcode"),
  countryId: z.string().optional().describe("Country ID (e.g. 'DK', 'US')"),
  phone: z.string().optional().describe("Phone number"),
  email: z.string().optional().describe("Email address"),
  registrationNo: z.string().optional().describe("VAT/CVR/Tax ID number"),
  isCustomer: z.boolean().optional().describe("Whether contact is a customer"),
  isSupplier: z.boolean().optional().describe("Whether contact is a supplier"),
  paymentTermsDays: z.number().int().min(0).optional().describe("Payment terms in days"),
};

writeTools.push(
  server.registerTool(
    "billy_create_contact",
    {
      title: "Create contact",
      description: "Create a new contact in Billy",
      inputSchema: {
        ...dryRunParam,
        ...contactFields,
        name: z.string().describe("Contact name"),
        countryId: z.string().describe("Country ID (e.g. 'DK', 'US')"),
        type: z.enum(["company", "person"]).optional().describe("Contact type"),
      },
      outputSchema: { ...billyEnvelope("contacts", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...args }) => call((billy) => billy.createContact(args), dryRun)
  )
);

writeTools.push(
  server.registerTool(
    "billy_update_contact",
    {
      title: "Update contact",
      description: "Update an existing contact. Only the supplied fields are changed.",
      inputSchema: { ...dryRunParam, ...contactFields, id: z.string().describe("Contact ID") },
      outputSchema: { ...billyEnvelope("contacts", "list"), ...dryRunOutput },
      annotations: updates,
    },
    ({ id, dryRun, ...contact }) => call((billy) => billy.updateContact(id, contact), dryRun)
  )
);

// --- Invoices ----------------------------------------------------------------

server.registerTool(
  "billy_list_invoices",
  {
    title: "List invoices",
    description: "List invoices with optional filtering and pagination",
    inputSchema: {
      ...listParams,
      ...dateRangeParams,
      contactId: z.string().optional().describe("Filter by contact ID"),
      state: z.enum(["draft", "approved"]).optional().describe("Filter by invoice state"),
      isPaid: z.boolean().optional().describe("Filter by payment status"),
      include: includeParam.describe("Related resources to include"),
    },
    outputSchema: billyEnvelope("invoices", "list"),
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getInvoices(args))
);

server.registerTool(
  "billy_get_invoice",
  {
    title: "Get invoice",
    description: "Get a specific invoice by ID",
    inputSchema: {
      id: z.string().describe("Invoice ID"),
      include: includeParam.describe("Related resources to include (e.g. 'invoice.lines,invoice.contact')"),
    },
    outputSchema: billyEnvelope("invoice", "single", ["invoiceLines"]),
    annotations: readOnly,
  },
  ({ id, include }) => call((billy) => billy.getInvoice(id, include))
);

const invoiceLine = z.object({
  productId: z.string().describe("Product ID"),
  description: z.string().optional().describe("Line description"),
  quantity: z.number().default(1).describe("Quantity"),
  unitPrice: z.number().describe("Unit price"),
});

const invoiceFields = {
  contactId: z.string().optional().describe("Contact ID"),
  entryDate: z.string().optional().describe("Invoice date (YYYY-MM-DD)"),
  currencyId: z.string().optional().describe("Currency ID (e.g. 'DKK', 'USD')"),
  invoiceNo: z.string().optional().describe("Invoice number (auto-generated by Billy if omitted)"),
  paymentTermsDays: z.number().int().min(0).optional().describe("Payment terms in days (inherited from the contact if omitted)"),
  contactMessage: z.string().optional().describe("Message to display on invoice"),
  state: z.enum(["draft", "approved"]).optional().describe("Invoice state"),
  lines: z.array(invoiceLine).optional().describe("Invoice lines"),
};

writeTools.push(
  server.registerTool(
    "billy_create_invoice",
    {
      title: "Create invoice",
      description: "Create a new invoice in Billy",
      inputSchema: {
        ...dryRunParam,
        ...invoiceFields,
        contactId: z.string().describe("Contact ID"),
        entryDate: z.string().describe("Invoice date (YYYY-MM-DD)"),
        currencyId: z.string().describe("Currency ID (e.g. 'DKK', 'USD')"),
        lines: z.array(invoiceLine).min(1).describe("Invoice lines (at least one)"),
      },
      outputSchema: { ...billyEnvelope("invoices", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...args }) => call((billy) => billy.createInvoice(args), dryRun)
  )
);

writeTools.push(
  server.registerTool(
    "billy_update_invoice",
    {
      title: "Update invoice",
      description: "Update an existing invoice. Only the supplied fields are changed. Approved invoices are generally immutable in Billy.",
      inputSchema: { ...dryRunParam, ...invoiceFields, id: z.string().describe("Invoice ID") },
      outputSchema: { ...billyEnvelope("invoices", "list"), ...dryRunOutput },
      annotations: updates,
    },
    ({ id, dryRun, ...invoice }) => call((billy) => billy.updateInvoice(id, invoice), dryRun)
  )
);

// --- Products ----------------------------------------------------------------

server.registerTool(
  "billy_list_products",
  {
    title: "List products",
    description: "List products with optional filtering and pagination",
    inputSchema: {
      ...listParams,
      isArchived: z.boolean().optional().describe("Filter by archived status"),
      include: includeParam.describe("Related resources to include"),
    },
    outputSchema: billyEnvelope("products", "list"),
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getProducts(args))
);

server.registerTool(
  "billy_get_product",
  {
    title: "Get product",
    description: "Get a specific product by ID",
    inputSchema: {
      id: z.string().describe("Product ID"),
      include: includeParam.describe("Related resources to include (e.g. 'product.prices')"),
    },
    outputSchema: billyEnvelope("product", "single", ["productPrices"]),
    annotations: readOnly,
  },
  ({ id, include }) => call((billy) => billy.getProduct(id, include))
);

writeTools.push(
  server.registerTool(
    "billy_create_product",
    {
      title: "Create product",
      description: "Create a new product in Billy",
      inputSchema: {
        ...dryRunParam,
        name: z.string().describe("Product name"),
        description: z.string().optional().describe("Product description"),
        productNo: z.string().optional().describe("Product number/SKU"),
        accountId: z.string().optional().describe("Revenue account ID"),
        salesTaxRulesetId: z.string().optional().describe("Sales tax ruleset ID"),
        prices: z
          .array(
            z.object({
              unitPrice: z.number().describe("Unit price"),
              currencyId: z.string().describe("Currency ID"),
            })
          )
          .optional()
          .describe("Product prices for different currencies"),
      },
      outputSchema: { ...billyEnvelope("products", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...args }) => call((billy) => billy.createProduct(args), dryRun)
  )
);

// --- Payments ----------------------------------------------------------------

server.registerTool(
  "billy_list_bank_payments",
  {
    title: "List bank payments",
    description: "List bank payments with optional filtering and pagination",
    inputSchema: {
      ...listParams,
      contactId: z.string().optional().describe("Filter by contact ID"),
      isVoided: z.boolean().optional().describe("Filter by voided status"),
    },
    outputSchema: billyEnvelope("bankPayments", "list"),
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getBankPayments(args))
);

writeTools.push(
  server.registerTool(
    "billy_create_payment",
    {
      title: "Create payment",
      description: "Create a payment to mark invoices or bills as paid",
      inputSchema: {
        ...dryRunParam,
        entryDate: z.string().describe("Payment date (YYYY-MM-DD)"),
        cashAmount: z.number().describe("Payment amount"),
        cashSide: z.enum(["debit", "credit"]).describe("debit for invoice payments, credit for bill payments"),
        cashAccountId: z.string().describe("Bank account ID where money was deposited/withdrawn"),
        associations: z
          .array(
            z.object({
              subjectReference: z.string().describe("Reference like 'invoice:invoiceId' or 'bill:billId'"),
            })
          )
          .min(1)
          .describe("Invoice/bill references to pay"),
        feeAmount: z.number().optional().describe("Bank/payment fee amount"),
        feeAccountId: z.string().optional().describe("Expense account ID for fees"),
      },
      outputSchema: { ...billyEnvelope("bankPayments", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...args }) => call((billy) => billy.createBankPayment(args), dryRun)
  )
);

// --- Bills -------------------------------------------------------------------

server.registerTool(
  "billy_list_bills",
  {
    title: "List bills",
    description: "List bills (vendor invoices) with optional filtering and pagination",
    inputSchema: {
      ...listParams,
      ...dateRangeParams,
      contactId: z.string().optional().describe("Filter by contact ID"),
      state: z.enum(["draft", "approved"]).optional().describe("Filter by bill state"),
      isPaid: z.boolean().optional().describe("Filter by payment status"),
      include: includeParam.describe("Related resources to include"),
    },
    outputSchema: billyEnvelope("bills", "list"),
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getBills(args))
);

writeTools.push(
  server.registerTool(
    "billy_create_bill",
    {
      title: "Create bill",
      description:
        "Create a bill (vendor invoice) in Billy. Line fields follow Billy's bill resource; unknown line fields are passed through unchanged.",
      inputSchema: {
        ...dryRunParam,
        contactId: z.string().describe("Supplier contact ID"),
        entryDate: z.string().describe("Bill date (YYYY-MM-DD)"),
        currencyId: z.string().describe("Currency ID (e.g. 'DKK', 'USD')"),
        paymentTermsDays: z.number().int().min(0).optional().describe("Payment terms in days"),
        suppliersInvoiceNo: z.string().optional().describe("The supplier's own invoice number"),
        state: z.enum(["draft", "approved"]).optional().describe("Bill state"),
        lines: z
          .array(
            z.looseObject({
              accountId: z.string().optional().describe("Expense account ID"),
              description: z.string().optional().describe("Line description"),
              amount: z.number().optional().describe("Line amount"),
              quantity: z.number().optional().describe("Quantity"),
              taxRateId: z.string().optional().describe("Tax rate ID"),
            })
          )
          .min(1)
          .describe("Bill lines (at least one)"),
      },
      outputSchema: { ...billyEnvelope("bills", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...args }) => call((billy) => billy.createBill(args), dryRun)
  )
);

// --- Accounts ----------------------------------------------------------------

server.registerTool(
  "billy_list_accounts",
  {
    title: "List accounts",
    description: "List the chart of accounts",
    inputSchema: {
      ...listParams,
      isArchived: z.boolean().optional().describe("Filter by archived status"),
      systemRole: z.string().optional().describe("Filter by system role"),
    },
    outputSchema: billyEnvelope("accounts", "list"),
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getAccounts(args))
);

// --- VAT and ledger ----------------------------------------------------------

server.registerTool(
  "billy_list_sales_tax_returns",
  {
    title: "List VAT returns",
    description:
      "List Billy's own VAT returns (momsangivelser) — the authoritative figures for a period. " +
      "Each has periodType (quarter/halfYear/year), startDate, endDate, reportDeadline, isSettled and isPaid. " +
      "Use this as the baseline before recomputing anything. Returns every return, filtered by period overlap.",
    inputSchema: dateRangeParams,
    outputSchema: { ...billyEnvelope("salesTaxReturns", "list"), ...completeness },
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getSalesTaxReturns(args))
);

server.registerTool(
  "billy_get_sales_tax_return",
  {
    title: "Get VAT return",
    description: "Get a single VAT return (momsangivelse) by ID",
    inputSchema: { id: z.string().describe("Sales tax return ID") },
    outputSchema: billyEnvelope("salesTaxReturn", "single"),
    annotations: readOnly,
  },
  ({ id }) => call((billy) => billy.getSalesTaxReturn(id))
);

server.registerTool(
  "billy_list_postings",
  {
    title: "List ledger postings",
    description:
      "List ledger postings — the double-entry lines where VAT actually lands. Each posting has " +
      "entryDate, accountId, amount, side (debit/credit), taxRateId and salesTaxReturnId. " +
      "This is the ground truth for VAT figures, ahead of invoice or bill totals. " +
      "All matching pages are fetched; check `truncated` before trusting a total.",
    inputSchema: {
      ...dateRangeParams,
      accountId: z.string().optional().describe("Filter by account ID"),
      taxRateId: z.string().optional().describe("Filter by tax rate ID"),
      salesTaxReturnId: z.string().optional().describe("Filter by the VAT return the posting belongs to"),
    },
    outputSchema: { ...billyEnvelope("postings", "list"), ...completeness },
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getPostings(args))
);

server.registerTool(
  "billy_list_daybook_transactions",
  {
    title: "List daybook transactions",
    description:
      "List manual journal entries (kassekladde). These bypass the normal invoice/bill flow, so they " +
      "warrant individual scrutiny in a VAT audit. All pages are fetched and filtered by entryDate.",
    inputSchema: {
      ...dateRangeParams,
      state: z.enum(["draft", "approved", "voided"]).optional().describe("Filter by transaction state"),
    },
    outputSchema: { ...billyEnvelope("daybookTransactions", "list"), ...completeness },
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getDaybookTransactions(args))
);

const daybookLine = z.object({
  account: z.string().describe("Account number (e.g. '7161') or account ID"),
  side: z.enum(["debit", "credit"]).describe("Side this line posts to on `account`"),
  amount: z.number().positive().describe("Amount; VAT-inclusive when taxRateId is set (Billy splits the VAT off)"),
  text: z.string().optional().describe("Line text"),
  taxRateId: z.string().optional().describe("Tax rate ID; omit for no VAT"),
  contraAccount: z
    .string()
    .optional()
    .describe("Account number or ID for the opposite side. Makes the line balance on its own"),
});

type DaybookInput = {
  entryDate: string;
  description?: string;
  voucherNo?: string;
  daybookId?: string;
  currencyId?: string;
  state: "draft" | "approved";
  lines: z.infer<typeof daybookLine>[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolves account numbers to IDs against the live chart of accounts, checks that
 * the entry balances, and builds both the request body and a readable preview.
 * Everything that can be wrong with an entry is caught here, before any write.
 */
async function prepareDaybookTransaction(billy: BillyClient, input: DaybookInput) {
  const [{ accounts }, { daybooks }, { organization }] = await Promise.all([
    billy.getAllAccounts(),
    billy.getDaybooks(),
    billy.getOrganization(),
  ]);

  const resolveAccount = (ref: string) => {
    const account = (accounts as any[]).find((a) => a.id === ref || String(a.accountNo) === ref);
    if (!account) throw new Error(`Unknown account "${ref}"`);
    if (account.isArchived) throw new Error(`Account ${account.accountNo} ${account.name} is archived`);
    return account;
  };
  const label = (a: any) => `${a.accountNo} ${a.name}`;

  let daybookId = input.daybookId;
  if (!daybookId) {
    if ((daybooks as any[]).length !== 1) {
      const names = (daybooks as any[]).map((d) => `${d.id} (${d.name})`).join(", ");
      throw new Error(`Specify daybookId; this organisation has ${daybooks.length} daybooks: ${names}`);
    }
    daybookId = daybooks[0].id;
  }
  const daybook = (daybooks as any[]).find((d) => d.id === daybookId);
  if (!daybook) throw new Error(`Unknown daybook "${daybookId}"`);

  const currencyId = input.currencyId ?? organization?.baseCurrencyId ?? "DKK";
  const lines = input.lines.map((line, index) => ({
    ...line,
    account: resolveAccount(line.account),
    contra: line.contraAccount ? resolveAccount(line.contraAccount) : undefined,
    amount: cents(line.amount),
    priority: index + 1,
  }));

  // Lines with a contra account balance themselves; the rest must net to zero.
  const open = lines.filter((l) => !l.contra);
  const debit = cents(open.filter((l) => l.side === "debit").reduce((sum, l) => sum + l.amount, 0));
  const credit = cents(open.filter((l) => l.side === "credit").reduce((sum, l) => sum + l.amount, 0));
  if (debit !== credit) {
    throw new Error(`Entry does not balance: debit ${debit} vs credit ${credit} (lines without a contra account)`);
  }

  const transaction = {
    organizationId: organization?.id,
    daybookId,
    entryDate: input.entryDate,
    voucherNo: input.voucherNo,
    description: input.description,
    state: input.state,
    lines: lines.map((l) => ({
      accountId: l.account.id,
      contraAccountId: l.contra?.id,
      side: l.side,
      amount: l.amount,
      text: l.text,
      taxRateId: l.taxRateId,
      currencyId,
      priority: l.priority,
    })),
  };

  const preview = {
    entryDate: input.entryDate,
    state: input.state,
    daybook: daybook.name,
    description: input.description ?? null,
    currencyId,
    lines: lines.map((l) => ({
      account: label(l.account),
      side: l.side,
      amount: l.amount,
      ...(l.contra ? { contraAccount: label(l.contra) } : {}),
      ...(l.taxRateId ? { taxRateId: l.taxRateId } : {}),
      ...(l.text ? { text: l.text } : {}),
    })),
  };

  return { transaction, preview };
}

writeTools.push(
  server.registerTool(
    "billy_create_daybook_transaction",
    {
      title: "Create journal entry",
      description:
        "Create a manual journal entry (kassekladde) for postings that have no invoice or bill behind them: " +
        "reclassifications, accruals, dividend and equity entries. Accounts may be given by number. " +
        "The entry must balance. Dry-runs by default, and creates a DRAFT unless state is 'approved', " +
        "so nothing reaches the ledger until someone approves it in Billy. Not for bank lines: " +
        "match those in Billy's bank reconciliation.",
      inputSchema: {
        ...dryRunParam,
        entryDate: z.string().regex(ISO_DATE, "must be YYYY-MM-DD").describe("Entry date (YYYY-MM-DD)"),
        description: z.string().optional().describe("Entry description"),
        voucherNo: z.string().optional().describe("Voucher number"),
        daybookId: z.string().optional().describe("Daybook ID; defaults to the organisation's only daybook"),
        currencyId: z.string().optional().describe("Currency; defaults to the organisation's base currency"),
        state: z.enum(["draft", "approved"]).default("draft").describe("Default draft; approve in Billy after review"),
        lines: z.array(daybookLine).min(1).describe("Entry lines"),
      },
      outputSchema: { ...billyEnvelope("daybookTransactions", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...input }) =>
      call(async (billy) => {
        const { transaction, preview } = await prepareDaybookTransaction(billy, input);
        return { ...(await billy.createDaybookTransaction(transaction)), preview };
      }, dryRun)
  )
);

writeTools.push(
  server.registerTool(
    "billy_delete_daybook_transaction",
    {
      title: "Delete draft journal entry",
      description:
        "Delete a DRAFT journal entry. Approved entries are refused: void those in Billy so the audit trail stays. " +
        "Dry-runs by default.",
      inputSchema: {
        ...dryRunParam,
        id: z.string().describe("Daybook transaction ID"),
      },
      outputSchema: { ...billyEnvelope("daybookTransactions", "list"), ...dryRunOutput },
      annotations: updates,
    },
    ({ id, dryRun }) =>
      call(async (billy) => {
        const { daybookTransaction: entry } = await billy.getDaybookTransaction(id);
        if (!entry) throw new Error(`Daybook transaction "${id}" not found`);
        if (entry.state !== "draft") {
          throw new Error(`Refusing to delete this entry: it is ${entry.state}, and only drafts can be deleted. Void it in Billy instead.`);
        }
        const preview = { id, entryDate: entry.entryDate, description: entry.description, state: entry.state };
        return { ...(await billy.deleteDaybookTransaction(id)), preview };
      }, dryRun)
  )
);

server.registerTool(
  "billy_list_tax_rates",
  {
    title: "List tax rates",
    description:
      "List the configured VAT/tax rates, including rate, name, abbreviation and predefinedTag " +
      "(e.g. 's_dk_non_eu_goods'), plus whether each applies to sales or purchases. " +
      "Use this to interpret the taxRateId on postings and invoice lines.",
    inputSchema: {
      appliesToSales: z.boolean().optional().describe("Only rates usable on sales"),
      appliesToPurchases: z.boolean().optional().describe("Only rates usable on purchases"),
      isActive: z.boolean().optional().describe("Filter by active status"),
    },
    outputSchema: { ...billyEnvelope("taxRates", "list"), ...completeness },
    annotations: readOnly,
  },
  (args) => call((billy) => billy.getTaxRates(args))
);

server.registerTool(
  "billy_list_account_groups",
  {
    title: "List account groups",
    description: "List chart-of-accounts groups (accountNo, name, type, natureId) for classifying accounts",
    inputSchema: {},
    outputSchema: { ...billyEnvelope("accountGroups", "list"), ...completeness },
    annotations: readOnly,
  },
  () => call((billy) => billy.getAccountGroups())
);

if (READ_ONLY) {
  for (const tool of writeTools) tool.remove();
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Billy MCP Server ${SERVER_VERSION} running on stdio ` +
      (READ_ONLY
        ? `(read-only: ${writeTools.length} write tools disabled)`
        : `(BILLY_ALLOW_WRITES is set: ${writeTools.length} write tools enabled)`)
  );
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
