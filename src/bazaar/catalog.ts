import { prisma } from '../db'
import type { NetworkName } from '../config'
import type {
  BazaarResourceListing,
  DiscoveryFilters,
  DiscoveryResponse,
  RegisterBazaarResourceInput,
} from './types'

/** CAIP-2 network ids used by @x402/stellar and returned in `accepts[].network`. */
const STELLAR_NETWORK_IDS: Record<NetworkName, string> = {
  mainnet: 'stellar:pubnet',
  testnet: 'stellar:testnet',
}

/**
 * Registers (or updates) a resource in the Bazaar catalog.
 *
 * HTTP resources are identified by (network, url, httpMethod); MCP resources
 * by (network, url, toolName) — the tuple the spec requires because multiple
 * tools can multiplex over one MCP server endpoint. Re-registering the same
 * identity updates the existing row instead of creating a duplicate, so a
 * resource server can safely call this on every startup.
 */
export async function registerBazaarResource(input: RegisterBazaarResourceInput): Promise<void> {
  const payTo = input.accepts[0]?.payTo
  if (!payTo) {
    throw new Error('registerBazaarResource: accepts[] must contain at least one payment requirement with payTo')
  }

  const base = {
    type: input.type,
    network: input.network,
    url: input.resource.url,
    description: input.resource.description ?? null,
    mimeType: input.resource.mimeType ?? null,
    serviceName: input.resource.serviceName ?? null,
    tags: input.resource.tags ?? [],
    iconUrl: input.resource.iconUrl ?? null,
    mcpToolName: input.type === 'mcp' ? (input.bazaar.info.input as { toolName: string }).toolName : null,
    httpMethod: input.type === 'http' ? (input.bazaar.info.input as { method: string }).method : null,
    accepts: input.accepts as object,
    payTo,
    bazaarInfo: input.bazaar.info as object,
    bazaarSchema: input.bazaar.schema as object,
    routeTemplate: input.bazaar.routeTemplate ?? null,
    extensionKeys: input.extensionKeys ?? ['bazaar'],
  }

  if (input.type === 'mcp') {
    const mcpToolName = base.mcpToolName as string
    await prisma.bazaarResource.upsert({
      where: {
        bazaarMcpIdentity: { network: input.network, url: input.resource.url, mcpToolName },
      },
      create: base,
      update: base,
    })
  } else {
    const httpMethod = base.httpMethod as string
    await prisma.bazaarResource.upsert({
      where: {
        bazaarHttpIdentity: { network: input.network, url: input.resource.url, httpMethod },
      },
      create: base,
      update: base,
    })
  }
}

export async function removeBazaarResource(network: NetworkName, url: string, key?: string): Promise<void> {
  await prisma.bazaarResource.deleteMany({
    where: {
      network,
      url,
      OR: [{ httpMethod: key ?? undefined }, { mcpToolName: key ?? undefined }],
    },
  })
}

/**
 * Parses and clamps query-string filters for GET /discovery/resources.
 * `limit` defaults to 50 and is clamped to [1, 200] to bound catalog scans;
 * `offset` defaults to 0 and cannot be negative.
 */
export function parseDiscoveryFilters(query: Record<string, unknown>): DiscoveryFilters {
  const rawLimit = Number(query.limit)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50

  const rawOffset = Number(query.offset)
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0

  const type = query.type === 'http' || query.type === 'mcp' ? query.type : undefined
  const payTo = typeof query.payTo === 'string' && query.payTo.length > 0 ? query.payTo : undefined
  const network = typeof query.network === 'string' && query.network.length > 0 ? query.network : undefined
  const extensions = typeof query.extensions === 'string' && query.extensions.length > 0 ? query.extensions : undefined

  return { type, payTo, network, extensions, limit, offset }
}

/**
 * Maps the spec's `network` filter value (a CAIP-2 id, e.g. "stellar:pubnet"
 * or "stellar:testnet") to our internal NetworkName column value. Falls back
 * to matching the raw string directly so a facilitator that passes our
 * NetworkName values (or any future non-Stellar CAIP-2 id we don't recognize
 * yet) does not silently match nothing.
 */
function resolveNetworkFilter(network: string | undefined): string | undefined {
  if (!network) return undefined
  const entry = (Object.entries(STELLAR_NETWORK_IDS) as [NetworkName, string][])
    .find(([, caip2]) => caip2 === network)
  return entry ? entry[0] : network
}

function toListing(row: {
  url: string
  description: string | null
  mimeType: string | null
  serviceName: string | null
  tags: string[]
  iconUrl: string | null
  accepts: unknown
  bazaarInfo: unknown
  bazaarSchema: unknown
  routeTemplate: string | null
  extensionKeys: string[]
}): BazaarResourceListing {
  const extensions: BazaarResourceListing['extensions'] = {
    bazaar: {
      info: row.bazaarInfo as BazaarResourceListing['extensions']['bazaar']['info'],
      schema: row.bazaarSchema as Record<string, unknown>,
      ...(row.routeTemplate ? { routeTemplate: row.routeTemplate } : {}),
    },
  }

  return {
    resource: {
      url: row.url,
      ...(row.description ? { description: row.description } : {}),
      ...(row.mimeType ? { mimeType: row.mimeType } : {}),
      ...(row.serviceName ? { serviceName: row.serviceName } : {}),
      ...(row.tags.length > 0 ? { tags: row.tags } : {}),
      ...(row.iconUrl ? { iconUrl: row.iconUrl } : {}),
    },
    accepts: row.accepts as BazaarResourceListing['accepts'],
    extensions,
  }
}

/**
 * GET /discovery/resources — paginated catalog query implementing the six
 * spec filters:
 *   - type: exact match on "http" | "mcp"
 *   - payTo: exact match against the resource's payment recipient
 *   - network: matches either our NetworkName ("mainnet"/"testnet") or the
 *     CAIP-2 id the spec's examples use ("stellar:pubnet"/"stellar:testnet")
 *   - extensions: matches resources that declare the given extension key
 *     (the spec's example is "bazaar", which every row declares by default)
 *   - limit / offset: standard offset pagination
 *
 * Ordering is (createdAt DESC, id DESC) — a stable tiebreaker on the primary
 * key — so that concurrent inserts during a paginated walk never shift
 * already-returned rows to a different page (the classic offset-pagination
 * hazard when ordering by a non-unique column alone).
 */
export async function queryDiscoveryResources(filters: DiscoveryFilters): Promise<DiscoveryResponse> {
  const where = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.payTo ? { payTo: filters.payTo } : {}),
    ...(filters.network ? { network: resolveNetworkFilter(filters.network) } : {}),
    ...(filters.extensions ? { extensionKeys: { has: filters.extensions } } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.bazaarResource.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit,
      skip: filters.offset,
    }),
    prisma.bazaarResource.count({ where }),
  ])

  return {
    resources: rows.map(toListing),
    limit: filters.limit,
    offset: filters.offset,
    total,
  }
}
