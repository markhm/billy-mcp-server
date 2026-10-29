// Contacts tools.

import { z } from "zod";
import { listParams, includeParam, billyEnvelope, readOnly, creates, updates, dryRunParam, dryRunOutput, call, type ToolRegistry } from "./shared.js";

const contactFields = {
  name: z.string().optional().describe("Contact name"),
  street: z.string().optional().describe("Street address"),
  city: z.string().optional().describe("City"),
  zipcode: z.string().optional().describe("Zipcode"),
  countryId: z.string().optional().describe("Country ID (e.g. 'DK', 'US')"),
  phone: z.string().optional().describe("Phone number"),
  email: z.string().optional().describe("Email address"),
  registrationNo: z.string().optional().describe("VAT/CVR/Tax ID number"),
  isCustomer: z.boolean().optional().describe("Whether contact is a customer"),
  isSupplier: z.boolean().optional().describe("Whether contact is a supplier"),
  paymentTermsDays: z.number().int().min(0).optional().describe("Payment terms in days"),
};

export function registerContactsTools({ server, writeTools }: ToolRegistry): void {
  server.registerTool(
    "billy_list_contacts",
    {
      title: "List contacts",
      description: "List contacts with optional filtering and pagination",
      inputSchema: {
        ...listParams,
        isCustomer: z.boolean().optional().describe("Filter by customer status"),
        isSupplier: z.boolean().optional().describe("Filter by supplier status"),
        include: includeParam.describe("Related resources to include"),
      },
      outputSchema: billyEnvelope("contacts", "list"),
      annotations: readOnly,
    },
    (args) => call((billy) => billy.getContacts(args))
  );

  server.registerTool(
    "billy_get_contact",
    {
      title: "Get contact",
      description: "Get a specific contact by ID",
      inputSchema: {
        id: z.string().describe("Contact ID"),
        include: includeParam.describe("Related resources to include (e.g. 'contact.contactPersons')"),
      },
      outputSchema: billyEnvelope("contact", "single", ["contactPersons"]),
      annotations: readOnly,
    },
    ({ id, include }) => call((billy) => billy.getContact(id, include))
  );

  writeTools.push(
    server.registerTool(
      "billy_create_contact",
      {
        title: "Create contact",
        description: "Create a new contact in Billy",
        inputSchema: {
          ...dryRunParam,
          ...contactFields,
          name: z.string().describe("Contact name"),
          countryId: z.string().describe("Country ID (e.g. 'DK', 'US')"),
          type: z.enum(["company", "person"]).optional().describe("Contact type"),
        },
        outputSchema: { ...billyEnvelope("contacts", "list"), ...dryRunOutput },
        annotations: creates,
      },
      ({ dryRun, ...args }) => call((billy) => billy.createContact(args), dryRun)
    )
  );

  writeTools.push(
    server.registerTool(
      "billy_update_contact",
      {
        title: "Update contact",
        description: "Update an existing contact. Only the supplied fields are changed.",
        inputSchema: { ...dryRunParam, ...contactFields, id: z.string().describe("Contact ID") },
        outputSchema: { ...billyEnvelope("contacts", "list"), ...dryRunOutput },
        annotations: updates,
      },
      ({ id, dryRun, ...contact }) => call((billy) => billy.updateContact(id, contact), dryRun)
    )
  );
}
