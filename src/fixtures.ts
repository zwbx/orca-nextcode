import type { InstanceConfig, Item, Session, Failure } from './protocol'

// Entirely synthetic. Users supply their own authorized instance contract privately.
export const config: InstanceConfig = {
  version: 1,
  origin: 'https://nextcode.example.com',
  auth: { header: 'Authorization', prefix: 'Bearer ' },
  projects: [{ id: 'demo-project', label: 'Example project' }],
  operations: {
    mr: { method: 'POST', path: '/example/read', body: { project: '$project', continuation: '$cursor', limit: '$limit' }, items: 'data.items',
      fields: { id: 'id', number: 'number', title: 'title', status: 'state', url: 'url' }, pagination: { mode: 'cursor', next: 'data.next' } },
    issue: { method: 'GET', path: '/example/issues', query: { project: '$project', after: '$cursor' }, items: 'data.items',
      fields: { id: 'id', number: 'number', title: 'title', status: 'state', url: 'url' }, pagination: { mode: 'cursor', next: 'data.next' } }
  },
  error: { path: 'error', code: 'code', message: 'message', policyPatterns: ['request source is restricted'] },
  pageSize: 2
}
export const demoItems: Item[] = [
  { id: 'mr-a', number: '!12', title: 'Improve sidebar navigation', status: 'open', url: config.origin + '/example/merge/12' },
  { id: 'mr-b', number: '!11', title: 'Add keyboard shortcuts', status: 'merged', url: config.origin + '/example/merge/11' }
]
export const demoSession: Session = { configured: true, origin: config.origin, projects: config.projects, kinds: ['mr', 'issue'], protection: 'os-keyring', credential: true }
export const policyFailure: Failure = { code: 'source_restricted', category: 'policy', message: 'Authentication policy rejected this request source. Use the instance’s documented authentication and allowed network conditions.', retryable: false }
export const demoWorkspaces = { workspaces: [{ id: 'local-demo', name: 'Sidebar navigation', host: 'local' }, { id: 'remote-demo', name: 'Shortcut review', host: 'ssh:example' }], truncated: false, associations: {} }
