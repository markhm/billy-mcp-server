// Schema fragments, annotation presets and the call() helper shared by every tool module.

import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBillyClient, type BillyClient } from "../client.js";

export const listParams = {
  page: z.number().int().min(0).optional().describe("Page number for pagination"),
  pageSize: z.number().int().min(1).max(1000).optional().describe("Number of items per page (max 1000)"),
  sortProperty: z.string().optional().describe("Property to sort by"),
  sortDirection: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
};

export const includeParam = z.string().optional();

/** Date-range filter on entryDate (bogføringsdato). Format is validated so a malformed
 *  date fails here rather than silently widening the period. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const dateRangeParams = {
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
export const completeness = {
  retrieved: z.number().optional().describe("Number of records actually returned after filtering"),
  truncated: z
    .boolean()
    .optional()
    .describe("True if the 5000-record cap was hit and results are incomplete. Billy narrows postings by date and accountId on the server, so narrowing those helps; daybook transactions, VAT returns, tax rates and account groups are filtered after fetching, so narrowing does not"),
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
export function billyEnvelope(resourceKey: string, kind: "list" | "single", sideloads: string[] = []) {
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

export const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
export const creates = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
export const updates = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

/**
 * Every write tool dry-runs by default: the request is returned, not sent. A write
 * therefore takes two deliberate calls — review, then repeat with dryRun: false —
 * on top of the BILLY_ALLOW_WRITES opt-in that exposes the tools at all.
 */
export const dryRunParam = {
  dryRun: z
    .boolean()
    .default(true)
    .describe("Default true: return the exact request without sending it. Set false only after the dry run was reviewed."),
};

export const dryRunOutput = {
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
export async function call(fn: (client: BillyClient) => Promise<any>, dryRun = false): Promise<ToolResult> {
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

/** What a tool module needs to register its tools. Mutating tools go through
 *  `writeTools.push(...)` so index.ts can remove them unless writes are enabled. */
export interface ToolRegistry {
  server: McpServer;
  writeTools: RegisteredTool[];
}
