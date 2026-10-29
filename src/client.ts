// The Billy v2 HTTP client. Every API call goes through BillyClient.request().

import axios, { AxiosResponse } from "axios";
import { API_BASE_URL, READ_ONLY } from "./config.js";

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
export function entryDatePeriodParam(fromDate?: string, toDate?: string): Record<string, string> {
  if (!fromDate && !toDate) return {};
  return { entryDatePeriod: `dates:${fromDate ?? "1900-01-01"}...${toDate ?? "2999-12-31"}` };
}

/** Inclusive ISO date-range test. ISO-8601 dates compare correctly as strings. */
export function withinRange(date: unknown, fromDate?: string, toDate?: string): boolean {
  if (typeof date !== "string") return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

/** Serialise query params, skipping absent values and coercing booleans/numbers. */
export function toQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

export class BillyClient {
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
export function describeErrorBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;

  if (typeof body === "string") {
    const brace = body.indexOf("{");
    if (brace >= 0) {
      const embedded = body.slice(brace);
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

export function getBillyClient(): BillyClient {
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
