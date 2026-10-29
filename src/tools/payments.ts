// Payments tools.

import { z } from "zod";
import { listParams, billyEnvelope, readOnly, creates, dryRunParam, dryRunOutput, call, type ToolRegistry } from "./shared.js";

export function registerPaymentsTools({ server, writeTools }: ToolRegistry): void {
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
}
