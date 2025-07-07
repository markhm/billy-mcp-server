#!/usr/bin/env node

/**
 * Test script to verify Billy API connection
 * Usage: node test-connection.js
 */

import axios from 'axios';
import { readFileSync } from 'fs';

// Load environment variables from .env file
try {
  const envFile = readFileSync('.env', 'utf8');
  const envVars = envFile.split('\n').filter(line => line.includes('=')).map(line => {
    const [key, value] = line.split('=');
    return { key: key.trim(), value: value.trim() };
  });
  
  envVars.forEach(({ key, value }) => {
    if (key && value && !key.startsWith('#')) {
      process.env[key] = value;
    }
  });
} catch (error) {
  // .env file not found, continue with system environment variables
}

const API_BASE_URL = "https://api.billysbilling.com/v2";
const ACCESS_TOKEN = process.env.BILLY_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error("❌ BILLY_ACCESS_TOKEN environment variable is required");
  process.exit(1);
}

async function testConnection() {
  console.log("🔍 Testing Billy API connection...");
  
  try {
    // Test 1: Get organization info
    console.log("📋 Testing organization endpoint...");
    const orgResponse = await axios({
      method: 'GET',
      url: `${API_BASE_URL}/organization`,
      headers: {
        'X-Access-Token': ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const org = orgResponse.data.organization;
    console.log(`✅ Organization: ${org.name} (${org.id})`);
    
    // Test 2: List contacts (limited)
    console.log("👥 Testing contacts endpoint...");
    const contactsResponse = await axios({
      method: 'GET',
      url: `${API_BASE_URL}/contacts?pageSize=5`,
      headers: {
        'X-Access-Token': ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const contacts = contactsResponse.data.contacts;
    console.log(`✅ Found ${contacts.length} contacts (showing max 5)`);
    
    // Test 3: List products (limited)
    console.log("📦 Testing products endpoint...");
    const productsResponse = await axios({
      method: 'GET',
      url: `${API_BASE_URL}/products?pageSize=5`,
      headers: {
        'X-Access-Token': ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const products = productsResponse.data.products;
    console.log(`✅ Found ${products.length} products (showing max 5)`);
    
    // Test 4: List invoices (limited)
    console.log("🧾 Testing invoices endpoint...");
    const invoicesResponse = await axios({
      method: 'GET',
      url: `${API_BASE_URL}/invoices?pageSize=5`,
      headers: {
        'X-Access-Token': ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const invoices = invoicesResponse.data.invoices;
    console.log(`✅ Found ${invoices.length} invoices (showing max 5)`);
    
    console.log("");
    console.log("🎉 All tests passed! Billy API connection is working correctly.");
    console.log("");
    console.log("Summary:");
    console.log(`- Organization: ${org.name}`);
    console.log(`- Base Currency: ${org.baseCurrency?.id || 'N/A'}`);
    console.log(`- Country: ${org.country?.id || 'N/A'}`);
    console.log(`- Contacts: ${contacts.length} found`);
    console.log(`- Products: ${products.length} found`);
    console.log(`- Invoices: ${invoices.length} found`);
    
  } catch (error) {
    console.error("❌ Connection test failed:");
    
    if (error.response) {
      console.error(`HTTP ${error.response.status}: ${error.response.statusText}`);
      console.error("Response:", error.response.data);
      
      if (error.response.status === 401) {
        console.error("");
        console.error("💡 This usually means your access token is invalid or expired.");
        console.error("   1. Check your .env file");
        console.error("   2. Generate a new token in Billy: Settings → Access tokens");
      }
    } else if (error.request) {
      console.error("Network error - could not reach Billy API");
      console.error("Check your internet connection");
    } else {
      console.error("Error:", error.message);
    }
    
    process.exit(1);
  }
}

// Run the test
testConnection().catch(console.error);
