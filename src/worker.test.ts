import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker.mjs'
import { config, demoWorkspaces } from './fixtures'

test('credential saving requires the exact origin, SSH alias, and OS keyring', async () => {
  const remoteConfig = { ...config, sshHost: 'authorized-host' }
  const host = mockHost({ capabilities: ["storage:own", "secrets:own", "workspace:read", "workspace:write"], storage: { 'instance-v1': JSON.parse(JSON.stringify(remoteConfig)) } })
  const worker = await mountWorker(main, { host })
  await assert.rejects(worker.request('credential', { token: 'synthetic-credential', expectedOrigin: config.origin, expectedSshHost: 'other-host' }))
  await assert.rejects(worker.request('credential', { token: 'synthetic-credential', expectedOrigin: 'https://other.example.com', expectedSshHost: 'authorized-host' }))
  const state = await worker.request('credential', { token: 'synthetic-credential', expectedOrigin: config.origin, expectedSshHost: 'authorized-host' })
  assert.equal(state.protection, 'os-keyring')
  assert.equal(state.credential, true)
  assert.equal(JSON.stringify(state).includes('synthetic-credential'), false)
  assert.equal(JSON.stringify(host.data().storage).includes('synthetic-credential'), false)
  assert.equal(host.data().secrets['token:' + config.origin + ':authorized-host'], 'synthetic-credential')
  await worker.request('forget')
  assert.equal((await worker.request('session')).credential, false)
  await worker.deactivate()
  const unprotected = mockHost({ capabilities: ["storage:own", "secrets:own", "workspace:read", "workspace:write"], storage: { 'instance-v1': JSON.parse(JSON.stringify(remoteConfig)) }, results: { 'secrets.protection': { status: 'unavailable' } } })
  const unsafeWorker = await mountWorker(main, { host: unprotected })
  await assert.rejects(unsafeWorker.request('credential', { token: 'synthetic-credential', expectedOrigin: config.origin, expectedSshHost: 'authorized-host' }))
  assert.equal(Object.keys(unprotected.data().secrets).length, 0)
  await unsafeWorker.deactivate()
})

test('association writes serialize, validate returned items and preserve other links', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { items: [{ id: 'one', number: 1, title: 'Synthetic item', state: 'open', url: config.origin + '/example/one' }], next: null } }))
  try {
    const host = mockHost({ capabilities: ["storage:own", "secrets:own", "workspace:read", "workspace:write"], storage: { 'instance-v1': JSON.parse(JSON.stringify(config)), 'associations-v1': { preserved: 'local-demo' } }, secrets: { ['token:' + config.origin + ':direct']: 'synthetic-credential' }, results: { 'workspace.open': { opened: true }, 'workspace.list': { workspaces: demoWorkspaces.workspaces.map(w => ({ ...w, hostId: w.host, kind: 'worktree', path: '/synthetic', branch: 'example' })), truncated: false } } })
    const worker = await mountWorker(main, { host })
    await assert.rejects(worker.request('associate', { url: config.origin + '/unseen', workspaceId: 'local-demo' }))
    assert.equal((await worker.request('list', { kind: 'mr', project: 'demo-project', cursor: null })).ok, true)
    await assert.rejects(worker.request('associate', { url: config.origin + '/example/one', workspaceId: 'missing' }))
    await Promise.all([
      worker.request('associate', { url: config.origin + '/example/one', workspaceId: 'local-demo' }),
      worker.request('associate', { url: config.origin + '/example/one', workspaceId: 'remote-demo' })
    ])
    assert.deepEqual(host.data().storage['associations-v1'], { preserved: 'local-demo', [config.origin + '/example/one']: 'remote-demo' })
    await worker.request('associate', { url: config.origin + '/example/one', workspaceId: '' })
    assert.deepEqual(host.data().storage['associations-v1'], { preserved: 'local-demo' })
    await worker.request('openWorkspace', { workspaceId: 'remote-demo' })
    assert.equal(host.callsOf('workspace.open').length, 1)
    await worker.deactivate()
  } finally { globalThis.fetch = originalFetch }
})
