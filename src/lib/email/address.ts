export function parseAddress(value: string) {
  const address = value.match(/<([^>]+)>/)?.[1] ?? value
  const normalized = address.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at < 1 || at === normalized.length - 1) return null
  return { local: normalized.slice(0, at), domain: normalized.slice(at + 1), address: normalized }
}

export function normalizeLocalPart(value: string) {
  return (value.split('+')[0] ?? '').replaceAll('.', '').toLowerCase()
}

export function formatAddress(address: string, name?: string | null) {
  if (!name?.trim()) return address
  return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${address}>`
}
