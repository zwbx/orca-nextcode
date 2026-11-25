import type { InstanceConfig, Json, Kind, ListResult, Operation, Failure } from './protocol'

export class ClientError extends Error {
  constructor(public failure: Failure) { super(failure.message) }
}
export function fail(code: string, message: string, category: Failure['category'] = 'configuration', retryable = false): never {
  throw new ClientError({ code, message, category, retryable })
}
export function secureOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { return fail('invalid_origin', 'Enter a valid HTTPS origin.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port) {
    return fail('invalid_origin', 'Use an HTTPS origin without a path, port, query or credentials.')
  }
  if (url.hostname === 'localhost' || url.hostname.includes(':') || /^[\d.]+$/.test(url.hostname) || !url.hostname.includes('.')) {
    return fail('invalid_origin', 'Use your authorized instance domain.')
  }
  return url.origin
}
export function parseConfig(raw: unknown, expectedOrigin: string): InstanceConfig {
  const config = raw as InstanceConfig
  if (!config || config.version !== 1 || secureOrigin(config.origin) !== secureOrigin(expectedOrigin)) {
    return fail('origin_mismatch', 'The configuration must match the origin you explicitly entered.')
  }
  if (!config.auth || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(config.auth.header) ||
      /^(host|cookie|proxy-|content-|connection|transfer-)/i.test(config.auth.header) ||
      typeof config.auth.prefix !== 'string' || config.auth.prefix.length > 64 || /[\r\n]/.test(config.auth.prefix)) {
    return fail('invalid_auth', 'Provide a valid authentication header and prefix.')
  }
  if (config.sshHost !== undefined && (typeof config.sshHost !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(config.sshHost))) {
    return fail('invalid_ssh_host', 'Use a trusted OpenSSH host alias.')
  }
  if (!Array.isArray(config.projects) || config.projects.length < 1 || config.projects.length > 100 ||
      config.projects.some(p => !p || typeof p.id !== 'string' || !p.id || p.id.length > 512 || typeof p.label !== 'string' || !p.label || p.label.length > 100) ||
      new Set(config.projects.map(p => p.id)).size !== config.projects.length) {
    return fail('invalid_projects', 'Provide 1–100 distinct project identifiers and labels.')
  }
  if (!config.operations || !Object.keys(config.operations).length || Object.keys(config.operations).some(k => k !== 'mr' && k !== 'issue')) {
    return fail('invalid_operations', 'Provide a read-only MR or Issue operation.')
  }
  for (const operation of Object.values(config.operations)) {
    if (!operation || !['GET', 'POST'].includes(operation.method) || typeof operation.path !== 'string' ||
        !operation.path.startsWith('/') || operation.path.startsWith('//') || operation.path.includes('\\') ||
        operation.path.includes('?') || operation.path.includes('#') || !operation.fields ||
        ['id', 'number', 'title', 'status', 'url'].some(k => typeof operation.fields[k as keyof Operation['fields']] !== 'string') || typeof operation.items !== 'string') {
      return fail('invalid_operation', 'An operation requires a same-origin path and response field mappings.')
    }
    if (new URL(operation.path, config.origin).origin !== config.origin) return fail('invalid_path', 'Operation paths must stay on the configured origin.')
    if (operation.query && (typeof operation.query !== 'object' || Object.values(operation.query).some(v => typeof v !== 'string'))) {
      return fail('invalid_query', 'Query values must be strings.')
    }
    if (operation.pagination && (!['cursor', 'page'].includes(operation.pagination.mode) ||
        (operation.pagination.mode === 'cursor' && !operation.pagination.next) ||
        (operation.pagination.mode === 'page' && !operation.pagination.total && !operation.pagination.hasMore))) {
      return fail('invalid_pagination', 'Pagination requires an explicit next cursor, total, or continuation flag.')
    }
  }
  if (config.error && (typeof config.error.path !== 'string' || typeof config.error.code !== 'string' || typeof config.error.message !== 'string' ||
      (config.error.policyPatterns && (!Array.isArray(config.error.policyPatterns) || config.error.policyPatterns.some(p => typeof p !== 'string' || !p))))) {
    return fail('invalid_error', 'Provide valid API error mappings.')
  }
  if (config.pageSize !== undefined && (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 100)) {
    return fail('invalid_limit', 'Page size must be between 1 and 100.')
  }
  return { ...config, origin: secureOrigin(config.origin) }
}
export function at(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(key)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}
function substitute(value: Json, variables: Record<string, string | number>): Json {
  if (typeof value === 'string') {
    if (Object.hasOwn(variables, value)) return variables[value]
    return value.replace(/\$(project|cursor|limit|state)\b/g, match => String(variables[match]))
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, variables))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, variables)]))
  return value
}
export function safeLink(value: unknown, origin: string): string {
  if (typeof value !== 'string' || value.length > 4096) return ''
  try {
    const url = new URL(value, origin)
    return url.origin === origin && !url.username && !url.password && url.protocol === 'https:' ? url.href : ''
  } catch { return '' }
}
function apiFailure(status: number, code: unknown, message: unknown, config: InstanceConfig): never {
  const safeCode = typeof code === 'string' && /^[\w.-]{1,80}$/.test(code) ? code : `http_${status}`
  if (typeof message === 'string' && config.error?.policyPatterns?.some(p => message.toLowerCase().includes(p.toLowerCase()))) {
    return fail(safeCode, 'Authentication policy rejected this request source. Use the instance’s documented authentication and allowed network conditions.', 'policy')
  }
  if (status === 401) return fail(safeCode, 'Authentication failed. Check the credential type and expiration.', 'authentication')
  if (status === 403) return fail(safeCode, 'Access denied. Check the instance policy and project read permissions.', 'permission')
  return fail(safeCode, 'The instance rejected this read request.', 'response', status === 429 || status >= 500)
}
export async function listItems(config: InstanceConfig, token: string, kind: Kind, project: string, cursor: string | null, transport: typeof fetch = fetch): Promise<ListResult> {
  try {
    const operation = config.operations[kind]
    if (!operation) return fail('unsupported', 'This instance configuration has no authorized API for this item type.')
    if (!config.projects.some(p => p.id === project)) return fail('invalid_project', 'Choose a configured project.')
    if (!token || /[\r\n]/.test(token)) return fail('missing_credential', 'Configure a credential for this exact origin.', 'authentication')
    if (cursor && (cursor.length > 4096 || /[\r\n]/.test(cursor))) return fail('invalid_cursor', 'Invalid continuation cursor.')
    const pageSize = config.pageSize ?? 25
    const page = cursor ?? String(operation.pagination?.start ?? 1)
    if (operation.pagination?.mode === 'page' && (!/^\d+$/.test(page) || !Number.isSafeInteger(Number(page)))) return fail('invalid_cursor', 'Invalid page number.')
    const variables = { $project: project, $cursor: operation.pagination?.mode === 'page' ? Number(page) : cursor ?? '', $limit: pageSize, $state: 'open' }
    const url = new URL(operation.path, config.origin)
    for (const [key, value] of Object.entries(operation.query ?? {})) url.searchParams.set(key, String(substitute(value, variables)))
    const body = operation.body === undefined ? undefined : JSON.stringify(substitute(operation.body, variables))
    const response = await transport(url, {
      method: operation.method, headers: { [config.auth.header]: config.auth.prefix + token, 'Content-Type': 'application/json' },
      body: operation.method === 'POST' ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000)
    })
    if (response.status >= 300 && response.status < 400) return fail('redirect_refused', 'The instance returned a redirect. Credentials stay bound to the configured origin.', 'policy')
    const raw = await response.text()
    if (raw.length > 2_000_000) return fail('response_too_large', 'The response exceeds the supported page size.', 'response')
    let payload: unknown
    try { payload = JSON.parse(raw) } catch {
      if (!response.ok) return apiFailure(response.status, undefined, undefined, config)
      return fail('invalid_response', 'The instance returned an unreadable response.', 'response')
    }
    const error = config.error ? at(payload, config.error.path) : undefined
    if (!response.ok || error) return apiFailure(response.status, config.error ? at(error, config.error.code) : undefined, config.error ? at(error, config.error.message) : undefined, config)
    const rows = at(payload, operation.items)
    if (!Array.isArray(rows)) return fail('invalid_mapping', 'The response does not contain the configured item array. Check the instance mapping.', 'response')
    if (rows.length > 100) return fail('too_many_items', 'The instance exceeded the requested page limit.', 'response')
    const items = rows.map(row => {
      const fields = Object.fromEntries(Object.entries(operation.fields).map(([key, path]) => [key, at(row, path)]))
      if (['id', 'number', 'title', 'status'].some(k => !['string', 'number'].includes(typeof fields[k]))) return fail('invalid_item', 'An item is missing required mapped fields.', 'response')
      return { id: String(fields.id).slice(0, 512), number: String(fields.number).slice(0, 80), title: String(fields.title).slice(0, 1000), status: String(fields.status).slice(0, 100), url: safeLink(fields.url, config.origin) }
    })
    let next: string | null = null
    const pagination = operation.pagination
    if (pagination?.mode === 'cursor') {
      const value = at(payload, pagination.next!)
      if (value !== undefined && value !== null && value !== '') {
        if (!['string', 'number'].includes(typeof value)) return fail('invalid_pagination', 'The next cursor mapping is invalid.', 'response')
        next = String(value)
      }
      if (pagination.hasMore && at(payload, pagination.hasMore) === false) next = null
    }
    if (pagination?.mode === 'page') {
      const total = pagination.total ? at(payload, pagination.total) : undefined
      const more = pagination.hasMore ? at(payload, pagination.hasMore) : undefined
      if (pagination.total && (typeof total !== 'number' || total < 0)) return fail('invalid_pagination', 'The total mapping is invalid.', 'response')
      if (pagination.hasMore && typeof more !== 'boolean') return fail('invalid_pagination', 'The continuation flag mapping is invalid.', 'response')
      if (more === true || (typeof total === 'number' && (Number(page) - (pagination.start ?? 1) + 1) * pageSize < total)) next = String(Number(page) + 1)
    }
    if (next === cursor && next !== null) return fail('repeated_cursor', 'The instance returned a repeated cursor.', 'response')
    return { ok: true, page: { items, next } }
  } catch (error) {
    if (error instanceof ClientError) return { ok: false, error: error.failure }
    return { ok: false, error: { code: 'connection_failed', message: 'The read request failed or timed out. Retry when the instance is reachable.', category: 'network', retryable: true } }
  }
}
