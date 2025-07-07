#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosResponse } from "axios";

const API_BASE_URL = "https://api.billysbilling.com/v2";

interface BillyConfig {
  accessToken: string;
  organizationId?: string;
}

class BillyClient {
  private accessToken: string;
  private organizationId?: string;

  constructor(config: BillyConfig) {
    this.accessToken = config.accessToken;
    this.organizationId = config.organizationId;
  }

  private async request(method: string, endpoint: string, data?: any): Promise<any> {
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
        throw new Error(`Billy API Error: ${error.response?.status} - ${error.response?.data || error.message}`);
      }
      throw error;
    }
  }

  async getOrganization(): Promise<any> {
    return this.request("GET", "/organization");
  }

  async getContacts(params?: any): Promise<any> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/contacts${queryString}`);
  }

  async getContact(id: string, include?: string): Promise<any> {
    const queryString = include ? `?include=${include}` : "";
    return this.request("GET", `/contacts/${id}${queryString}`);
  }

  async createContact(contactData: any): Promise<any> {
    return this.request("POST", "/contacts", { contact: contactData });
  }

  async updateContact(id: string, contactData: any): Promise<any> {
    return this.request("PUT", `/contacts/${id}`, { contact: contactData });
  }

  async getInvoices(params?: any): Promise<any> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/invoices${queryString}`);
  }

  async getInvoice(id: string, include?: string): Promise<any> {
    const queryString = include ? `?include=${include}` : "";
    return this.request("GET", `/invoices/${id}${queryString}`);
  }

  async createInvoice(invoiceData: any): Promise<any> {
    return this.request("POST", "/invoices", { invoice: invoiceData });
  }

  async updateInvoice(id: string, invoiceData: any): Promise<any> {
    return this.request("PUT", `/invoices/${id}`, { invoice: invoiceData });
  }

  async getProducts(params?: any): Promise<any> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/products${queryString}`);
  }

  async getProduct(id: string, include?: string): Promise<any> {
    const queryString = include ? `?include=${include}` : "";
    return this.request("GET", `/products/${id}${queryString}`);
  }

  async createProduct(productData: any): Promise<any> {
    return this.request("POST", "/products", { product: productData });
  }

  async getBankPayments(params?: any): Promise<any> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/bankPayments${queryString}`);
  }

  async createBankPayment(paymentData: any): Promise<any> {
    return this.request("POST", "/bankPayments", { bankPayment: paymentData });
  }

  async getBills(params?: any): Promise<any> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/bills${queryString}`);
  }

  async createBill(billData: any): Promise<any> {
    return this.request("POST", "/bills", { bill: billData });
  }

  async getAccounts(params?: any): Promise<any> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request("GET", `/accounts${queryString}`);
  }
}

const server = new Server(
  {
    name: "billy-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Billy client
let billyClient: BillyClient | null = null;

function initializeBillyClient(): BillyClient {
  const accessToken = process.env.BILLY_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("BILLY_ACCESS_TOKEN environment variable is required");
  }

  return new BillyClient({ accessToken });
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "billy_get_organization",
        description: "Get organization details from Billy",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "billy_list_contacts",
        description: "List contacts with optional filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number for pagination" },
            pageSize: { type: "number", description: "Number of items per page (max 1000)" },
            sortProperty: { type: "string", description: "Property to sort by" },
            sortDirection: { type: "string", enum: ["ASC", "DESC"], description: "Sort direction" },
            isCustomer: { type: "boolean", description: "Filter by customer status" },
            isSupplier: { type: "boolean", description: "Filter by supplier status" },
          },
        },
      },
      {
        name: "billy_get_contact",
        description: "Get a specific contact by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Contact ID", required: true },
            include: { type: "string", description: "Related resources to include (e.g., 'contact.contactPersons')" },
          },
          required: ["id"],
        },
      },
      {
        name: "billy_create_contact",
        description: "Create a new contact in Billy",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Contact name", required: true },
            type: { type: "string", enum: ["company", "person"], description: "Contact type" },
            countryId: { type: "string", description: "Country ID (e.g., 'DK', 'US')", required: true },
            street: { type: "string", description: "Street address" },
            city: { type: "string", description: "City" },
            zipcode: { type: "string", description: "Zipcode" },
            phone: { type: "string", description: "Phone number" },
            email: { type: "string", description: "Email address" },
            registrationNo: { type: "string", description: "VAT/CVR/Tax ID number" },
            isCustomer: { type: "boolean", description: "Whether contact is a customer" },
            isSupplier: { type: "boolean", description: "Whether contact is a supplier" },
            paymentTermsDays: { type: "number", description: "Payment terms in days" },
          },
          required: ["name", "countryId"],
        },
      },
      {
        name: "billy_update_contact",
        description: "Update an existing contact",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Contact ID", required: true },
            name: { type: "string", description: "Contact name" },
            street: { type: "string", description: "Street address" },
            city: { type: "string", description: "City" },
            zipcode: { type: "string", description: "Zipcode" },
            phone: { type: "string", description: "Phone number" },
            email: { type: "string", description: "Email address" },
            registrationNo: { type: "string", description: "VAT/CVR/Tax ID number" },
            isCustomer: { type: "boolean", description: "Whether contact is a customer" },
            isSupplier: { type: "boolean", description: "Whether contact is a supplier" },
            paymentTermsDays: { type: "number", description: "Payment terms in days" },
          },
          required: ["id"],
        },
      },
      {
        name: "billy_list_invoices",
        description: "List invoices with optional filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number for pagination" },
            pageSize: { type: "number", description: "Number of items per page (max 1000)" },
            sortProperty: { type: "string", description: "Property to sort by" },
            sortDirection: { type: "string", enum: ["ASC", "DESC"], description: "Sort direction" },
            contactId: { type: "string", description: "Filter by contact ID" },
            state: { type: "string", enum: ["draft", "approved"], description: "Filter by invoice state" },
            isPaid: { type: "boolean", description: "Filter by payment status" },
            include: { type: "string", description: "Related resources to include" },
          },
        },
      },
      {
        name: "billy_get_invoice",
        description: "Get a specific invoice by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Invoice ID", required: true },
            include: { type: "string", description: "Related resources to include (e.g., 'invoice.lines,invoice.contact')" },
          },
          required: ["id"],
        },
      },
      {
        name: "billy_create_invoice",
        description: "Create a new invoice in Billy",
        inputSchema: {
          type: "object",
          properties: {
            contactId: { type: "string", description: "Contact ID", required: true },
            entryDate: { type: "string", description: "Invoice date (YYYY-MM-DD)", required: true },
            currencyId: { type: "string", description: "Currency ID (e.g., 'DKK', 'USD')", required: true },
            invoiceNo: { type: "string", description: "Invoice number (optional, auto-generated if not provided)" },
            paymentTermsDays: { type: "number", description: "Payment terms in days" },
            contactMessage: { type: "string", description: "Message to display on invoice" },
            lines: {
              type: "array",
              description: "Invoice lines",
              items: {
                type: "object",
                properties: {
                  productId: { type: "string", description: "Product ID", required: true },
                  description: { type: "string", description: "Line description" },
                  quantity: { type: "number", description: "Quantity", default: 1 },
                  unitPrice: { type: "number", description: "Unit price", required: true },
                },
                required: ["productId", "unitPrice"],
              },
              required: true,
            },
            state: { type: "string", enum: ["draft", "approved"], description: "Invoice state" },
          },
          required: ["contactId", "entryDate", "currencyId", "lines"],
        },
      },
      {
        name: "billy_list_products",
        description: "List products with optional filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number for pagination" },
            pageSize: { type: "number", description: "Number of items per page (max 1000)" },
            sortProperty: { type: "string", description: "Property to sort by" },
            sortDirection: { type: "string", enum: ["ASC", "DESC"], description: "Sort direction" },
            isArchived: { type: "boolean", description: "Filter by archived status" },
            include: { type: "string", description: "Related resources to include" },
          },
        },
      },
      {
        name: "billy_get_product",
        description: "Get a specific product by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Product ID", required: true },
            include: { type: "string", description: "Related resources to include (e.g., 'product.prices')" },
          },
          required: ["id"],
        },
      },
      {
        name: "billy_create_product",
        description: "Create a new product in Billy",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Product name", required: true },
            description: { type: "string", description: "Product description" },
            productNo: { type: "string", description: "Product number/SKU" },
            accountId: { type: "string", description: "Revenue account ID" },
            salesTaxRulesetId: { type: "string", description: "Sales tax ruleset ID" },
            prices: {
              type: "array",
              description: "Product prices for different currencies",
              items: {
                type: "object",
                properties: {
                  unitPrice: { type: "number", description: "Unit price", required: true },
                  currencyId: { type: "string", description: "Currency ID", required: true },
                },
                required: ["unitPrice", "currencyId"],
              },
            },
          },
          required: ["name"],
        },
      },
      {
        name: "billy_list_bank_payments",
        description: "List bank payments with optional filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number for pagination" },
            pageSize: { type: "number", description: "Number of items per page (max 1000)" },
            sortProperty: { type: "string", description: "Property to sort by" },
            sortDirection: { type: "string", enum: ["ASC", "DESC"], description: "Sort direction" },
            contactId: { type: "string", description: "Filter by contact ID" },
            isVoided: { type: "boolean", description: "Filter by voided status" },
          },
        },
      },
      {
        name: "billy_create_payment",
        description: "Create a payment to mark invoices as paid",
        inputSchema: {
          type: "object",
          properties: {
            entryDate: { type: "string", description: "Payment date (YYYY-MM-DD)", required: true },
            cashAmount: { type: "number", description: "Payment amount", required: true },
            cashSide: { type: "string", enum: ["debit", "credit"], description: "debit for invoice payments, credit for bill payments", required: true },
            cashAccountId: { type: "string", description: "Bank account ID where money was deposited/withdrawn", required: true },
            associations: {
              type: "array",
              description: "Invoice/bill references to pay",
              items: {
                type: "object",
                properties: {
                  subjectReference: { type: "string", description: "Reference like 'invoice:invoiceId' or 'bill:billId'", required: true },
                },
                required: ["subjectReference"],
              },
              required: true,
            },
            feeAmount: { type: "number", description: "Bank/payment fee amount" },
            feeAccountId: { type: "string", description: "Expense account ID for fees" },
          },
          required: ["entryDate", "cashAmount", "cashSide", "cashAccountId", "associations"],
        },
      },
      {
        name: "billy_list_bills",
        description: "List bills (vendor invoices) with optional filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number for pagination" },
            pageSize: { type: "number", description: "Number of items per page (max 1000)" },
            sortProperty: { type: "string", description: "Property to sort by" },
            sortDirection: { type: "string", enum: ["ASC", "DESC"], description: "Sort direction" },
            contactId: { type: "string", description: "Filter by contact ID" },
            state: { type: "string", enum: ["draft", "approved"], description: "Filter by bill state" },
            isPaid: { type: "boolean", description: "Filter by payment status" },
          },
        },
      },
      {
        name: "billy_list_accounts",
        description: "List chart of accounts",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number for pagination" },
            pageSize: { type: "number", description: "Number of items per page (max 1000)" },
            sortProperty: { type: "string", description: "Property to sort by" },
            sortDirection: { type: "string", enum: ["ASC", "DESC"], description: "Sort direction" },
            isArchived: { type: "boolean", description: "Filter by archived status" },
            systemRole: { type: "string", description: "Filter by system role" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (!billyClient) {
      billyClient = initializeBillyClient();
    }

    const { name, arguments: args } = request.params;
    const safeArgs = args || {};

    switch (name) {
      case "billy_get_organization":
        const org = await billyClient.getOrganization();
        return { content: [{ type: "text", text: JSON.stringify(org, null, 2) }] };

      case "billy_list_contacts":
        const contacts = await billyClient.getContacts(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };

      case "billy_get_contact":
        const contact = await billyClient.getContact((safeArgs as any).id, (safeArgs as any).include);
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };

      case "billy_create_contact":
        const newContact = await billyClient.createContact(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(newContact, null, 2) }] };

      case "billy_update_contact":
        const { id, ...updateData } = safeArgs as any;
        const updatedContact = await billyClient.updateContact(id, updateData);
        return { content: [{ type: "text", text: JSON.stringify(updatedContact, null, 2) }] };

      case "billy_list_invoices":
        const invoices = await billyClient.getInvoices(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(invoices, null, 2) }] };

      case "billy_get_invoice":
        const invoice = await billyClient.getInvoice((safeArgs as any).id, (safeArgs as any).include);
        return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }] };

      case "billy_create_invoice":
        const newInvoice = await billyClient.createInvoice(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(newInvoice, null, 2) }] };

      case "billy_list_products":
        const products = await billyClient.getProducts(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(products, null, 2) }] };

      case "billy_get_product":
        const product = await billyClient.getProduct((safeArgs as any).id, (safeArgs as any).include);
        return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };

      case "billy_create_product":
        const newProduct = await billyClient.createProduct(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(newProduct, null, 2) }] };

      case "billy_list_bank_payments":
        const payments = await billyClient.getBankPayments(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(payments, null, 2) }] };

      case "billy_create_payment":
        const newPayment = await billyClient.createBankPayment(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(newPayment, null, 2) }] };

      case "billy_list_bills":
        const bills = await billyClient.getBills(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(bills, null, 2) }] };

      case "billy_list_accounts":
        const accounts = await billyClient.getAccounts(safeArgs);
        return { content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }] };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Billy MCP Server running on stdio");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
