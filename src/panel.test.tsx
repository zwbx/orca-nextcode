import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { demoSession, demoItems, demoWorkspaces, policyFailure } from './fixtures'

test('selects items, links original details, associates local and remote workspaces, and paginates', async () => {
  let page = 0
  const host = mockHost({ requests: {
    session: () => demoSession, workspaces: () => demoWorkspaces,
    list: () => ({ ok: true, page: { items: page++ ? [{ ...demoItems[0], id: 'mr-c', number: '!10' }] : demoItems, next: page === 1 ? 'next' : null } }),
    associate: () => ({ ok: true }), openWorkspace: () => ({ opened: true })
  } })
  const view = await mount(panel, { host })
  assert.deepEqual(view.rowsOf({ label: 'NextCode items' }), ['mr-a', 'mr-b'])
  await view.selectRows({ label: 'NextCode items' }, ['mr-a'])
  assert.equal(view.find({ text: 'Open original details' })?.props?.href, demoItems[0].url)
  for (const workspace of ['local-demo', 'remote-demo']) {
    await view.selectRows({ label: 'NextCode items' }, ['mr-a'])
    await view.select({ label: 'Orca workspace' }, workspace)
    await view.press({ text: 'Save association' })
    await view.press({ text: 'Open workspace' })
  }
  await view.press({ text: 'Load more' })
  assert.equal(view.rowsOf({ label: 'NextCode items' }).length, 3)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})
test('policy errors have a distinct heading and Retry recovers', async () => {
  let failed = true
  const host = mockHost({ requests: { session: () => demoSession, workspaces: () => demoWorkspaces, list: () => failed ? { ok: false, error: policyFailure } : { ok: true, page: { items: [], next: null } } } })
  const view = await mount(panel, { host })
  assert.ok(view.summary().some(s => s.includes('Authentication policy error')))
  failed = false
  await view.press({ text: 'Retry' })
  assert.equal(view.summary().some(s => s.includes('Authentication policy error')), false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
