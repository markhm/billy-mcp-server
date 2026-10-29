// Organization tools.

import { billyEnvelope, readOnly, call, type ToolRegistry } from "./shared.js";

export function registerOrganizationTools({ server }: ToolRegistry): void {
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
}
