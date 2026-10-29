// VAT returns and tax rates tools.

import { z } from "zod";
import { dateRangeParams, completeness, billyEnvelope, readOnly, call, type ToolRegistry } from "./shared.js";

export function registerVatTools({ server }: ToolRegistry): void {
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
}
