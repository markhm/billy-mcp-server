// Daybook (journal entries) tools.

import { z } from "zod";
import type { BillyClient } from "../client.js";
import { ISO_DATE, dateRangeParams, completeness, billyEnvelope, readOnly, creates, updates, dryRunParam, dryRunOutput, call, type ToolRegistry } from "./shared.js";

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
export async function prepareDaybookTransaction(billy: BillyClient, input: DaybookInput) {
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

export function registerDaybookTools({ server, writeTools }: ToolRegistry): void {
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
}
