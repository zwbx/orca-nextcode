// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh
// host. Seed what the worker reads so check shows more than the first state.
import { defineCheck } from 'orca/testing'
import { demoSession, demoItems, demoWorkspaces, policyFailure } from './fixtures'

const requests = { session: () => demoSession, workspaces: () => demoWorkspaces }
export default defineCheck({
  fresh: { requests: { session: () => ({ ...demoSession, configured: false, projects: [], kinds: [], credential: false }), workspaces: () => demoWorkspaces } },
  populated: { requests: { ...requests, list: () => ({ ok: true, page: { items: demoItems, next: 'next-demo' } }) } },
  empty: { requests: { ...requests, list: () => ({ ok: true, page: { items: [], next: null } }) } },
  policy: { requests: { ...requests, list: () => ({ ok: false, error: policyFailure }) } },
  authentication: { requests: { ...requests, list: () => ({ ok: false, error: { code: 'http_401', category: 'authentication', message: 'Authentication failed. Check the credential type and expiration.', retryable: false } }) } },
  permission: { requests: { ...requests, list: () => ({ ok: false, error: { code: 'http_403', category: 'permission', message: 'Access denied. Check the instance policy and project read permissions.', retryable: false } }) } }
})
