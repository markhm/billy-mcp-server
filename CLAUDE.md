# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript in build/ directory
- `npm run dev` - Run server in development mode with tsx
- `npm run watch` - Run server in watch mode (auto-restart on changes)
- `npm start` - Run the compiled server from build/index.js

### Testing
- `node test-connection.js` - Test Billy API connection and verify credentials
- Set `BILLY_ACCESS_TOKEN` environment variable before running tests

### Environment Setup
- Requires Node.js 18+
- Set `BILLY_ACCESS_TOKEN` environment variable with your Billy API access token
- Run `npm install` to install dependencies

## Architecture

This is a Model Context Protocol (MCP) server that provides Claude with tools to interact with Billy's accounting API. The architecture consists of:

### Core Components

**BillyClient Class (src/index.html:18-124)**
- Handles all Billy API communication
- Manages authentication via X-Access-Token header
- Provides methods for contacts, invoices, products, payments, bills, and accounts
- Base URL: `https://api.billysbilling.com/v2`

**MCP Server (src/index.html:126-516)**
- Implements MCP protocol using @modelcontextprotocol/sdk
- Provides 13 tools for Billy API operations
- Uses stdio transport for communication
- Lazy-initializes Billy client on first tool call

### Key Design Patterns

**API Request Pattern**
- All API calls go through `BillyClient.request()` method
- Consistent error handling with axios error transformation
- Query parameters handled via URLSearchParams

**MCP Tool Structure**
- Each tool has detailed JSON schema for input validation
- Tools return JSON responses wrapped in MCP text content
- Error responses include `isError: true` flag

### Billy API Integration

**Authentication**
- Uses access token authentication (X-Access-Token header)
- Token set via BILLY_ACCESS_TOKEN environment variable
- No OAuth support (Billy limitation)

**Data Operations**
- CRUD operations for contacts, invoices, products
- Read-only access for bills and accounts
- Payment creation for invoice reconciliation
- Supports pagination, filtering, and related data inclusion

**Key Entities**
- Contacts: Customers and suppliers with full address/tax info
- Invoices: Line items with product references and pricing
- Products: Catalog items with multi-currency pricing
- Payments: Bank payments that can be associated with invoices/bills

## File Structure

```
src/index.html          # Main MCP server implementation (actually TypeScript)
test-connection.js      # API connection test utility
build/                  # Compiled JavaScript output
package.json           # Dependencies and npm scripts
tsconfig.json          # TypeScript configuration
```

## Development Notes

- The main source file is incorrectly named `index.html` but contains TypeScript code
- Uses ES modules (type: "module" in package.json)
- TypeScript compilation targets ES2022 with strict mode
- Server runs on stdio transport for MCP communication
- Error messages are logged to stderr, not stdout (to avoid interfering with MCP protocol)

## Billy API Specifics

- Currency codes: Use ISO format (DKK, USD, EUR)
- Date format: YYYY-MM-DD for all date fields
- Payment associations: Use format "invoice:invoiceId" or "bill:billId"
- Invoice states: "draft" or "approved"
- Payment cash sides: "debit" for invoice payments, "credit" for bill payments
- Maximum page size: 1000 items per request