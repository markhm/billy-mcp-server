// Bills tools.

import { z } from "zod";
import { listParams, includeParam, dateRangeParams, billyEnvelope, readOnly, creates, dryRunParam, dryRunOutput, call, type ToolRegistry } from "./shared.js";

export function registerBillsTools({ server, writeTools }: ToolRegistry): void {
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
}
