import 'dotenv/config';
import { BazaarMcpServer } from '../../src/mcp/server';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createEd25519Signer } from '@x402/stellar';
import { Keypair } from '@stellar/stellar-sdk';

async function main() {
  const secretKey = process.env.MCP_AGENT_SECRET_KEY || Keypair.random().secret();
  const testnetSigner = createEd25519Signer(secretKey, 'stellar:testnet');
  const pubnetSigner = createEd25519Signer(secretKey, 'stellar:pubnet');
  
  const testnetClient = new ExactStellarScheme(testnetSigner);
  const pubnetClient = new ExactStellarScheme(pubnetSigner);
  
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(globalThis.fetch, {
    schemes: [
      {
        network: 'stellar:testnet',
        client: testnetClient,
      },
      {
        network: 'stellar:pubnet',
        client: pubnetClient,
      }
    ]
  });

  const server = new BazaarMcpServer({
    fetchWithPayment
  });

  console.error('[mcp-server] Starting Bazaar MCP server on stdio...');
  console.error('[mcp-server] Agent configured for stellar:testnet and stellar:pubnet');
  
  await server.run();
}

main().catch(err => {
  console.error('[mcp-server] Fatal error:', err);
  process.exit(1);
});
