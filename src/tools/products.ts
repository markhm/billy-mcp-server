// Products tools.

import { z } from "zod";
import { listParams, includeParam, billyEnvelope, readOnly, creates, dryRunParam, dryRunOutput, call, type ToolRegistry } from "./shared.js";

export function registerProductsTools({ server, writeTools }: ToolRegistry): void {
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
}
