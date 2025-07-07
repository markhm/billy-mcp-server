#!/bin/bash

# Billy MCP Server Setup Script

set -e

echo "🚀 Setting up Billy MCP Server..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version check passed: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building TypeScript..."
npm run build

# Check if build was successful
if [ ! -f "build/index.js" ]; then
    echo "❌ Build failed. Please check for errors above."
    exit 1
fi

echo "✅ Build completed successfully"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file and add your Billy access token"
fi

# Make the script executable
chmod +x build/index.js

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Edit .env file and add your Billy access token"
echo "2. Add the server to your MCP client configuration"
echo "3. Test the connection with: npm start"
echo ""
echo "For Claude Desktop, add this to your claude_desktop_config.json:"
echo "{"
echo '  "mcpServers": {'
echo '    "billy": {'
echo '      "command": "node",'
echo "      \"args\": [\"$(pwd)/build/index.js\"],"
echo '      "env": {'
echo '        "BILLY_ACCESS_TOKEN": "your_token_here"'
echo '      }'
echo '    }'
echo '  }'
echo "}"
