import { assert, test } from 'orca/testing'
import { listItems, parseConfig, secureOrigin, safeLink } from './client'
import { config, demoItems } from './fixtures'

function transport(payload: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(payload), { status })
}
const rows = demoItems.map(i => ({ ...i, state: i.status }))
test('config requires an explicitly confirmed HTTPS origin and safe paths', () => {
  assert.equal(parseConfig(config, config.origin).origin, config.origin)
  for (const origin of ['http://nextcode.example.com', 'https://user:pass@nextcode.example.com', 'https://127.0.0.1', 'https://nextcode.example.com/path', 'https://nextcode.example.com:443']) {
    // URL canonicalization strips the default port.
    if (origin.endsWith(':443')) continue
    assert.throws(() => secureOrigin(origin))
  }
  assert.throws(() => parseConfig(config, 'https://other.example.com'))
  assert.throws(() => parseConfig({ ...config, operations: { mr: { ...config.operations.mr, path: '//other.example.com' } } }, config.origin))
  assert.equal(safeLink('https://other.example.com/details', config.origin), '')
  assert.equal(safeLink('https://user:pass@nextcode.example.com/details', config.origin), '')
})
test('maps rows, empty lists, and cursor continuation with encoded query values', async () => {
  const result = await listItems(config, 'synthetic-credential', 'mr', 'demo-project', null, transport({ data: { items: rows, next: 'cursor-2' } }))
  assert.deepEqual(result, { ok: true, page: { items: demoItems, next: 'cursor-2' } })
  assert.deepEqual(await listItems(config, 'synthetic-credential', 'mr', 'demo-project', null, transport({ data: { items: [], next: null } })), { ok: true, page: { items: [], next: null } })
  let requestUrl = ''
  let redirect = ''
  const fetcher: typeof fetch = async (url, options) => {
    requestUrl = String(url)
    redirect = options?.redirect ?? ''
    return new Response(JSON.stringify({ data: { items: [], next: null } }))
  }
  await listItems(config, 'synthetic-credential', 'issue', 'demo-project', 'x&destination=other', fetcher)
  assert.equal(new URL(requestUrl).searchParams.get('after'), 'x&destination=other')
  assert.equal(redirect, 'manual')
})
test('empty and unsafe links never resolve to the instance home page', async () => {
  const missing = { ...rows[0], url: '' }
  const payload = (url: string) => transport({ data: { items: [{ ...missing, url }], next: null } })
  const operation = { ...config.operations.mr!, detailPath: '$projectPath/item/$number' }
  const mapped = parseConfig({ ...config, projects: [{ ...config.projects[0], detailPath: '/example/project' }], operations: { mr: operation } }, config.origin)
  for (const [profile, url, expected] of [
    [config, '', ''], [config, '  ', ''], [config, '/', ''],
    [mapped, '', config.origin + '/example/project/item/!12'],
    [mapped, 'https://other.example.com/item/12', '']
  ] as const) {
    const result = await listItems(profile, 'synthetic-credential', 'mr', 'demo-project', null, payload(url))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.page.items[0].url, expected)
  }
})

test('handles page-based pagination and detects broken continuation', async () => {
  const paged = { ...config, operations: { mr: { ...config.operations.mr!, pagination: { mode: 'page' as const, total: 'data.total' }, body: { page: '$cursor' } } } }
  assert.deepEqual(await listItems(paged, 'synthetic-credential', 'mr', 'demo-project', null, transport({ data: { items: rows, total: 3 } })), { ok: true, page: { items: demoItems, next: '2' } })
  const repeated = await listItems(config, 'synthetic-credential', 'mr', 'demo-project', 'same', transport({ data: { items: rows, next: 'same' } }))
  assert.equal(repeated.ok, false)
  if (!repeated.ok) assert.equal(repeated.error.code, 'repeated_cursor')
})
test('401, 403, source policy, redirects and invalid mappings remain failures', async () => {
  for (const [status, payload, category] of [
    [401, { error: { code: 'expired', message: 'secret-value' } }, 'authentication'],
    [403, { error: { code: 'denied', message: 'secret-value' } }, 'permission'],
    [403, { error: { code: 'restricted', message: 'request source is restricted' } }, 'policy'],
    [302, {}, 'policy'], [200, {}, 'response']
  ] as const) {
    const result = await listItems(config, 'synthetic-credential', 'mr', 'demo-project', null, transport(payload, status))
    assert.equal(result.ok, false)
    if (!result.ok) { assert.equal(result.error.category, category); assert.equal(result.error.message.includes('secret-value'), false) }
  }
  const unavailable: typeof fetch = async () => { throw new Error('synthetic-credential') }
  const result = await listItems(config, 'synthetic-credential', 'mr', 'demo-project', null, unavailable)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.retryable, true)
})
