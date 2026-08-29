import 'dotenv/config'
import { Networks } from '@stellar/stellar-sdk'
import type { WatchedPair, AssetId } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NetworkName = 'testnet' | 'mainnet'

/** Per-network configuration block. */
export interface NetworkConfig {
  horizon: {
    url: string
  }
  rpc: {
    url: string
  }
  network: {
    passphrase: string
  }
  soroswap: {
    /** Soroswap factory contract address for this network. */
    factoryAddress: string
    /** How often to poll Soroswap pool reserves in ms. */
    pollIntervalMs: number
  }
  oracle: {
    /** Reflector oracle contract ID for this network. */
    reflectorContractId: string
  }
  /** Watched asset pairs for this network. */
  pairs: WatchedPair[]
  facilitator: {
    /** Secret key for the facilitator's fee-paying account */
    secretKey?: string
    /** Maximum fee in stroops the facilitator will pay */
    feeStroops: number
  }
}

// ── Asset / pair parsing ───────────────────────────────────────────────────────

function parseAsset(str: string): AssetId {
  const [code, issuer] = str.split(':')
  return {
    code: code.toUpperCase(),
    issuer: (!issuer || issuer.toLowerCase() === 'native') ? null : issuer,
  }
}

function makePairKey(a: AssetId, b: AssetId): string {
  const aStr = a.issuer ? `${a.code}:${a.issuer}` : a.code
  const bStr = b.issuer ? `${b.code}:${b.issuer}` : b.code
  // Alphabetical sort so XLM/USDC and USDC/XLM resolve to the same key
  return [aStr, bStr].sort().join('/')
}

function parseWatchedPairs(raw: string): WatchedPair[] {
  if (!raw.trim()) return []
  return raw.split(',').map(pair => {
    const [a, b] = pair.trim().split('/')
    if (!a || !b) {
      throw new Error(
        `Invalid pair format: "${pair}". Expected "CODE:ISSUER/CODE:ISSUER"`
      )
    }
    const assetA = parseAsset(a)
    const assetB = parseAsset(b)
    return { assetA, assetB, pairKey: makePairKey(assetA, assetB) }
  })
}

// ── Per-network config builder ────────────────────────────────────────────────

/**
 * Build a NetworkConfig for the given network name.
 *
 * Resolution order for each field (first value that is non-empty wins):
 *   1. Paired env var  — e.g. HORIZON_URL_TESTNET / HORIZON_URL_MAINNET
 *   2. Generic env var — e.g. HORIZON_URL   (back-compat with single-network setups)
 *   3. Sensible default for that network
 */
function buildNetworkConfig(network: NetworkName): NetworkConfig {
  const suffix = network.toUpperCase() as 'TESTNET' | 'MAINNET'

  // ── Horizon ──────────────────────────────────────────────────────────────
  const horizonUrl =
    process.env[`HORIZON_URL_${suffix}`] ||
    (network === 'testnet' ? process.env.HORIZON_URL : undefined) ||
    (network === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org')

  // ── Soroban RPC ───────────────────────────────────────────────────────────
  const rpcUrl =
    process.env[`RPC_URL_${suffix}`] ||
    (network === 'testnet' ? process.env.RPC_URL : undefined) ||
    (network === 'mainnet'
      ? 'https://mainnet.sorobanrpc.com'
      : 'https://soroban-testnet.stellar.org')

  // ── Network passphrase ────────────────────────────────────────────────────
  const passphrase =
    process.env[`NETWORK_PASSPHRASE_${suffix}`] ||
    (network === 'testnet' ? process.env.NETWORK_PASSPHRASE : undefined) ||
    (network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET)

  // ── Soroswap factory ──────────────────────────────────────────────────────
  const soroswapFactory =
    process.env[`SOROSWAP_FACTORY_ADDRESS_${suffix}`] ||
    process.env.SOROSWAP_FACTORY_ADDRESS ||
    (network === 'mainnet'
      ? 'CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2'
      : 'CDKP5WSEZMDL53VZFPBGCL47WBPKFCN5OPYQVXB3CJWUXHPZRPHSSZ3')

  const soroswapPollMs = parseInt(
    process.env[`SOROSWAP_POLL_INTERVAL_MS_${suffix}`] ||
    process.env.SOROSWAP_POLL_INTERVAL_MS ||
    '60000',
    10
  )

  // ── Reflector oracle ──────────────────────────────────────────────────────
  const reflectorContractId =
    process.env[`REFLECTOR_CONTRACT_ID_${suffix}`] ||
    process.env.REFLECTOR_CONTRACT_ID ||
    (network === 'mainnet'
      ? 'CCYXZMNHFXHKF3YEX4VJJ5TH3YHCVZIBPNBGM7C4PJIMCIMNNWDOQYA'
      : '')

  // ── Watched pairs ─────────────────────────────────────────────────────────
  const rawPairs =
    process.env[`WATCHED_PAIRS_${suffix}`] ||
    (network === 'testnet' ? process.env.WATCHED_PAIRS : undefined) ||
    ''

  // ── Facilitator ───────────────────────────────────────────────────────────
  const facilitatorSecretKey =
    process.env[`FACILITATOR_SECRET_KEY_${suffix}`] ||
    (network === 'testnet' ? process.env.FACILITATOR_SECRET_KEY : undefined)

  const facilitatorFeeStroops = parseInt(
    process.env[`FACILITATOR_FEE_STROOPS_${suffix}`] ||
    process.env.FACILITATOR_FEE_STROOPS ||
    '50000',
    10
  )

  return {
    horizon: { url: horizonUrl },
    rpc: { url: rpcUrl },
    network: { passphrase },
    soroswap: {
      factoryAddress: soroswapFactory,
      pollIntervalMs: soroswapPollMs,
    },
    oracle: { reflectorContractId },
    pairs: parseWatchedPairs(rawPairs),
    facilitator: { secretKey: facilitatorSecretKey, feeStroops: facilitatorFeeStroops },
  }
}

// ── Global (non-network-specific) config ──────────────────────────────────────

const globalConfig = {
  db: {
    url: process.env.DATABASE_URL ?? 'postgresql://lens:lens@localhost:5432/lens',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  api: {
    port: parseInt(process.env.PORT ?? '3002', 10),
    host: process.env.HOST ?? '0.0.0.0',
  },
  indexer: {
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10),
    sdexPageSize: parseInt(process.env.SDEX_PAGE_SIZE ?? '200', 10),
    ammPageSize: parseInt(process.env.AMM_PAGE_SIZE ?? '200', 10),
  },
  cache: {
    priceTtl: parseInt(process.env.PRICE_CACHE_TTL ?? '10', 10),
  },
} as const

// ── Per-network map ───────────────────────────────────────────────────────────

/**
 * `config.networks` holds a fully-resolved config block for each Stellar
 * network.  Each block is built lazily on first access so startup cost stays
 * minimal when only one network is active.
 */
const _networkCache = new Map<NetworkName, NetworkConfig>()

function resolveNetwork(name: NetworkName): NetworkConfig {
  const cached = _networkCache.get(name)
  if (cached) return cached
  const built = buildNetworkConfig(name)
  _networkCache.set(name, built)
  return built
}

/**
 * Return the fully-resolved config for a given network.
 *
 * @example
 * const { horizon, rpc, soroswap } = getNetworkConfig('mainnet')
 */
export function getNetworkConfig(network: NetworkName): NetworkConfig {
  return resolveNetwork(network)
}

// ── Active network ────────────────────────────────────────────────────────────

/**
 * The active network, driven by the `STELLAR_NETWORK` env var.
 * Falls back to `'testnet'` when unset so local dev always works.
 */
export const activeNetwork: NetworkName =
  (process.env.STELLAR_NETWORK?.toLowerCase() as NetworkName | undefined) === 'mainnet'
    ? 'mainnet'
    : 'testnet'

// ── Unified config export ─────────────────────────────────────────────────────

/**
 * The main config export consumed throughout the app.
 *
 * - `config.networks.testnet` / `config.networks.mainnet` — per-network blocks
 * - `config.network`  — shorthand for the currently-active network block
 *                       (driven by `STELLAR_NETWORK` env var; defaults to testnet)
 * - All other top-level keys (`db`, `redis`, `api`, `indexer`, `cache`) are
 *   network-agnostic and shared across both networks.
 *
 * Back-compat: any existing code that reads `config.horizon.url`,
 * `config.rpc.url`, `config.network.passphrase`, `config.soroswap.*`, or
 * `config.pairs` continues to work — those paths now proxy to the active
 * network's block.
 */
export const config = {
  // ── Network map ────────────────────────────────────────────────────────────
  networks: {
    get testnet(): NetworkConfig { return resolveNetwork('testnet') },
    get mainnet(): NetworkConfig { return resolveNetwork('mainnet') },
  },

  // ── Active-network shortcuts (back-compat) ─────────────────────────────────
  get horizon()  { return resolveNetwork(activeNetwork).horizon },
  get rpc()      { return resolveNetwork(activeNetwork).rpc },
  get network()  { return resolveNetwork(activeNetwork).network },
  get soroswap() { return resolveNetwork(activeNetwork).soroswap },
  get oracle()   { return resolveNetwork(activeNetwork).oracle },
  get pairs()    { return resolveNetwork(activeNetwork).pairs },
  get facilitator() { return resolveNetwork(activeNetwork).facilitator },

  // ── Global / network-agnostic ──────────────────────────────────────────────
  db:      globalConfig.db,
  redis:   globalConfig.redis,
  api:     globalConfig.api,
  indexer: globalConfig.indexer,
  cache:   globalConfig.cache,
}
