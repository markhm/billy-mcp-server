# Billy MCP Server

A Model Context Protocol (MCP) server for integrating with Billy's accounting system. This server provides tools to interact with Billy's REST API for managing invoices, contacts, products, payments, and other accounting data.

## Features

- **Contact Management**: Create, read, update, and list contacts
- **Invoice Management**: Create, read, and list invoices with line items
- **Product Management**: Create, read, and list products with pricing
- **Payment Processing**: Create payments to mark invoices as paid
- **Bill Management**: List and manage vendor bills
- **Account Management**: Access chart of accounts
- **Organization Info**: Get organization details

## Prerequisites

- Node.js 18 or higher
- Billy account with API access
- Billy API access token

## Installation

1. Clone or download the server code
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the TypeScript code:
   ```bash
   npm run build
   ```

## Configuration

### Getting a Billy API Token

1. Log into your Billy account
2. Go to Settings → Access tokens
3. Create a new access token
4. Copy the token for use in the environment variable

### Environment Variables

Set the following environment variable:

```bash
export BILLY_ACCESS_TOKEN="your_billy_access_token_here"
```

### MCP Client Configuration

Add the server to your MCP client configuration. For Claude Desktop, add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "billy": {
      "command": "node",
      "args": ["/path/to/billy-mcp-server/build/index.js"],
      "env": {
        "BILLY_ACCESS_TOKEN": "your_billy_access_token_here"
      }
    }
  }
}
```

## Available Tools

### Organization

- `billy_get_organization` - Get organization details

### Contacts

- `billy_list_contacts` - List contacts with optional filtering
- `billy_get_contact` - Get a specific contact by ID
- `billy_create_contact` - Create a new contact
- `billy_update_contact` - Update an existing contact

### Invoices

- `billy_list_invoices` - List invoices with optional filtering
- `billy_get_invoice` - Get a specific invoice by ID
- `billy_create_invoice` - Create a new invoice with line items

### Products

- `billy_list_products` - List products with optional filtering
- `billy_get_product` - Get a specific product by ID
- `billy_create_product` - Create a new product with pricing

### Payments

- `billy_list_bank_payments` - List bank payments
- `billy_create_payment` - Create a payment to mark invoices as paid

### Bills

- `billy_list_bills` - List vendor bills

### Accounts

- `billy_list_accounts` - List chart of accounts

## Usage Examples

### Create a Contact

```javascript
// Using the billy_create_contact tool
{
  "name": "Acme Corporation",
  "type": "company",
  "countryId": "DK",
  "street": "Main Street 123",
  "city": "Copenhagen",
  "zipcode": "1000",
  "phone": "+45 12 34 56 78",
  "email": "contact@acme.com",
  "isCustomer": true,
  "paymentTermsDays": 30
}
```

### Create an Invoice

```javascript
// Using the billy_create_invoice tool
{
  "contactId": "contact-id-here",
  "entryDate": "2024-01-15",
  "currencyId": "DKK",
  "paymentTermsDays": 30,
  "lines": [
    {
      "productId": "product-id-here",
      "description": "Consulting services",
      "quantity": 10,
      "unitPrice": 1000
    }
  ],
  "state": "approved"
}
```

### Create a Payment

```javascript
// Using the billy_create_payment tool
{
  "entryDate": "2024-01-20",
  "cashAmount": 10000,
  "cashSide": "debit",
  "cashAccountId": "bank-account-id",
  "associations": [
    {
      "subjectReference": "invoice:invoice-id-here"
    }
  ]
}
```

## API Documentation

For detailed information about Billy's API, visit: https://www.billy.dk/api

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building

```bash
npm run build
```

### File Structure

```
src/
  index.ts          # Main server implementation
build/              # Compiled JavaScript output
package.json        # Dependencies and scripts
tsconfig.json       # TypeScript configuration
README.md          # This file
```

## Error Handling

The server includes comprehensive error handling for:
- Invalid API tokens
- Network connectivity issues
- Invalid request parameters
- Billy API errors

All errors are returned with descriptive messages to help with debugging.

## Supported Billy API Features

This MCP server supports the core Billy API functionality including:

- ✅ Organization management
- ✅ Contact management (customers/suppliers)
- ✅ Invoice creation and management
- ✅ Product catalog management
- ✅ Payment processing
- ✅ Bill management (vendor invoices)
- ✅ Chart of accounts access
- ✅ Pagination and filtering
- ✅ Related data inclusion (sideloading/embedding)
- ✅ Error handling and validation

## Limitations

- Authentication is limited to access tokens (OAuth not yet supported by Billy)
- Some advanced features like late fees, reminders, and attachments are not yet implemented
- Bank line matching and daybook transactions are not included in this version

## Security Considerations

- Store your Billy access token securely
- Use environment variables rather than hardcoding tokens
- Tokens in Billy don't expire but can be revoked from the Billy interface
- Each token is tied to a specific organization

## Contributing

To extend this MCP server:

1. Add new tools to the `ListToolsRequestSchema` handler
2. Implement the corresponding API calls in the `BillyClient` class
3. Add the tool handling logic in the `CallToolRequestSchema` handler
4. Update this README with the new functionality

### Adding a New Tool Example

```typescript
// 1. Add to tools list
{
  name: "billy_new_feature",
  description: "Description of the new feature",
  inputSchema: {
    type: "object",
    properties: {
      // Define parameters
    },
  },
}

// 2. Add to BillyClient class
async newFeature(params: any): Promise<any> {
  return this.request("GET", "/new-endpoint", params);
}

// 3. Add to request handler
case "billy_new_feature":
  const result = await billyClient.newFeature(args);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
```

## Troubleshooting

### Common Issues

1. **"BILLY_ACCESS_TOKEN environment variable is required"**
   - Make sure you've set the environment variable correctly
   - Check that your MCP client configuration includes the env section

2. **"Billy API Error: 401"**
   - Your access token is invalid or has been revoked
   - Generate a new token from Billy's interface

3. **"Billy API Error: 403"**
   - Your token doesn't have permission for the requested operation
   - Check that you're using a company token, not a user token for certain operations

4. **"Billy API Error: 404"**
   - The requested resource (invoice, contact, etc.) doesn't exist
   - Check that you're using the correct ID

5. **"Billy API Error: 422"**
   - Invalid data in your request
   - Check required fields and data formats (especially dates: YYYY-MM-DD)

### Debug Mode

To enable more detailed logging, you can modify the server to log requests:

```typescript
// Add to the request method in BillyClient
console.error(`Making ${method} request to ${url}`, data);
```

## License

MIT License - feel free to modify and distribute as needed.

## Support

For Billy API questions, contact: dev@billy.dk
For MCP server issues, please create an issue in your repository.