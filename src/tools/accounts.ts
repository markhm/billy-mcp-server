// Accounts tools.

import { z } from "zod";
import { listParams, completeness, billyEnvelope, readOnly, call, type ToolRegistry } from "./shared.js";

export function registerAccountsTools({ server }: ToolRegistry): void {
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
}
