import 'dotenv/config';
import { BazaarMcpServer } from '../../src/mcp/server';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createEd25519Signer } from '@x402/stellar';
import { Keypair } from '@stellar/stellar-sdk';

async function main() {
  const secretKey = process.env.MCP_AGENT_SECRET_KEY || Keypair.random().secret();
  const network = process.env.MCP_AGENT_NETWORK || 'stellar:testnet';
  
  const signer = createEd25519Signer(secretKey, network);
  const client = new ExactStellarScheme(signer);
  
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(globalThis.fetch, {
    schemes: [
      {
        network: 'stellar:*',
        client,
      }
    ]
  });

  const server = new BazaarMcpServer({
    fetchWithPayment
  });

  console.error('[mcp-server] Starting Bazaar MCP server on stdio...');
  console.error(`[mcp-server] Agent network: ${network}`);
  
  await server.run();
}

main().catch(err => {
  console.error('[mcp-server] Fatal error:', err);
  process.exit(1);
});
