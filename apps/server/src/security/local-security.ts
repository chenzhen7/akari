import { timingSafeEqual } from 'node:crypto'

export const AUTH_COOKIE_NAME = 'akari_session'

function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export function buildAllowedOrigins(
  port: string | undefined,
  configuredOrigins: string | undefined,
  includeDevOrigin: boolean,
): Set<string> {
  const origins = new Set<string>()
  const parsedPort = Number(port ?? 3001)
  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    origins.add(`http://localhost:${parsedPort}`)
    origins.add(`http://127.0.0.1:${parsedPort}`)
  }
  if (includeDevOrigin) {
    origins.add('http://localhost:5173')
    origins.add('http://127.0.0.1:5173')
  }
  for (const value of configuredOrigins?.split(',') ?? []) {
    const normalized = normalizeOrigin(value.trim())
    if (normalized) origins.add(normalized)
  }
  return origins
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  return normalized !== null && allowedOrigins.has(normalized)
}

export function isRequestOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: Set<string>,
): boolean {
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  if (allowedOrigins.has(normalized)) return true
  if (!host) return false

  try {
    const originUrl = new URL(normalized)
    const requestUrl = new URL(`http://${host}`)
    return isLoopbackHostname(originUrl.hostname)
      && isLoopbackHostname(requestUrl.hostname)
      && originUrl.port === requestUrl.port
  } catch {
    return false
  }
}

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}

function getCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (name === AUTH_COOKIE_NAME) return part.slice(separator + 1).trim()
  }
  return null
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  return match?.[1]?.trim() || null
}

export function hasValidAuthToken(
  authorization: string | undefined,
  cookie: string | undefined,
  expectedToken: string,
): boolean {
  const candidates = [getBearerToken(authorization), getCookieToken(cookie)]
  return candidates.some(token => token !== null && safeTokenEqual(token, expectedToken))
}

export function isPublicStaticRequest(method: string, requestUrl: string): boolean {
  if (method === 'OPTIONS') return true
  if (method !== 'GET' && method !== 'HEAD') return false
  let pathname: string
  try {
    pathname = new URL(requestUrl, 'http://localhost').pathname
  } catch {
    return false
  }
  return pathname === '/'
    || pathname === '/index.html'
    || pathname.startsWith('/assets/')
    || pathname === '/favicon.ico'
}
