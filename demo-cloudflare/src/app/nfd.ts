// NFDomains (.algo names) resolution utilities
// Uses the NFD API: https://api.nf.domains

const NFD_API = 'https://api.nf.domains'

// Cache to avoid repeated lookups
const nameCache = new Map<string, string | null>()
const addressCache = new Map<string, string | null>()

/**
 * Resolve an Algorand address to its primary NFD name.
 * Returns null if the address has no NFD.
 */
export async function addressToNfd(address: string): Promise<string | null> {
  if (nameCache.has(address)) return nameCache.get(address)!

  try {
    const res = await fetch(`${NFD_API}/nfd/lookup?address=${address}&view=tiny`)
    if (!res.ok) {
      nameCache.set(address, null)
      return null
    }
    const data = (await res.json()) as Record<string, Array<{ name: string }>>
    const entries = data[address]
    const name = entries?.[0]?.name ?? null
    nameCache.set(address, name)
    return name
  } catch {
    nameCache.set(address, null)
    return null
  }
}

/**
 * Resolve an NFD name (.algo) to its deposit Algorand address.
 * Returns null if the name doesn't exist.
 */
export async function nfdToAddress(name: string): Promise<string | null> {
  const normalized = name.toLowerCase().endsWith('.algo') ? name.toLowerCase() : `${name.toLowerCase()}.algo`

  if (addressCache.has(normalized)) return addressCache.get(normalized)!

  try {
    const res = await fetch(`${NFD_API}/nfd/${normalized}?view=tiny`)
    if (!res.ok) {
      addressCache.set(normalized, null)
      return null
    }
    const data = (await res.json()) as { depositAccount?: string; owner?: string }
    // depositAccount is the address that should receive funds
    const address = data.depositAccount ?? data.owner ?? null
    addressCache.set(normalized, address)
    return address
  } catch {
    addressCache.set(normalized, null)
    return null
  }
}

/**
 * Check if a string looks like an NFD name (contains .algo or is a simple name).
 */
export function isNfdName(input: string): boolean {
  const trimmed = input.trim().toLowerCase()
  if (trimmed.endsWith('.algo')) return true
  // Simple name without dots — could be an NFD (e.g. "alice" → "alice.algo")
  if (/^[a-z0-9-]+$/.test(trimmed) && trimmed.length <= 27) return true
  return false
}

/**
 * Resolve an input that could be an address or NFD name to an address.
 * If it's already a 58-char address, returns it as-is.
 * If it's an NFD name, resolves to the deposit address.
 */
export async function resolveToAddress(input: string): Promise<string | null> {
  const trimmed = input.trim()
  if (!trimmed) return null
  // 58-char base32 = Algorand address
  if (trimmed.length === 58 && /^[A-Z2-7]+$/.test(trimmed)) return trimmed
  // Try NFD resolution
  return nfdToAddress(trimmed)
}
