import { describe, expect, it } from 'vitest'
import {
  buildAllowedOrigins,
  hasValidAuthToken,
  isCorsOriginAllowed,
  isPublicStaticRequest,
  isRequestOriginAllowed,
} from '../security/local-security.js'

describe('local service security', () => {
  const allowedOrigins = buildAllowedOrigins('43917', undefined, false)

  it('allows only configured CORS origins', () => {
    expect(isCorsOriginAllowed('http://localhost:43917', allowedOrigins)).toBe(true)
    expect(isCorsOriginAllowed('https://example.test', allowedOrigins)).toBe(false)
  })

  it('accepts same-port loopback origins and rejects foreign origins', () => {
    expect(isRequestOriginAllowed('http://127.0.0.1:43917', 'localhost:43917', new Set())).toBe(true)
    expect(isRequestOriginAllowed('http://localhost:5173', 'localhost:3001', new Set())).toBe(false)
    expect(isRequestOriginAllowed('https://example.test', 'localhost:43917', allowedOrigins)).toBe(false)
  })

  it('accepts bearer and cookie credentials using exact token matching', () => {
    expect(hasValidAuthToken('Bearer secret-token', undefined, 'secret-token')).toBe(true)
    expect(hasValidAuthToken(undefined, 'theme=dark; akari_session=secret-token', 'secret-token')).toBe(true)
    expect(hasValidAuthToken('Bearer secret-token-extra', undefined, 'secret-token')).toBe(false)
  })

  it('leaves only bootstrap assets and preflight public', () => {
    expect(isPublicStaticRequest('GET', '/?workspaceId=one')).toBe(true)
    expect(isPublicStaticRequest('GET', '/assets/index.js')).toBe(true)
    expect(isPublicStaticRequest('GET', '/assets/../workspaces')).toBe(false)
    expect(isPublicStaticRequest('GET', '/assets/%2e%2e/workspaces')).toBe(false)
    expect(isPublicStaticRequest('OPTIONS', '/workspaces')).toBe(true)
    expect(isPublicStaticRequest('GET', '/workspaces')).toBe(false)
    expect(isPublicStaticRequest('POST', '/')).toBe(false)
  })
})
