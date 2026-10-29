// Ledger postings tools.

import { z } from "zod";
import { dateRangeParams, completeness, billyEnvelope, readOnly, call, type ToolRegistry } from "./shared.js";

export function registerPostingsTools({ server }: ToolRegistry): void {
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
}
