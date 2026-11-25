import { readFile, stat } from 'node:fs/promises'
import { parseConfig, secureOrigin, listItems, safeLink, fail } from './client.ts'
import { sshTransport } from './ssh.mjs'

const CONFIG = 'instance-v1'
const LINKS = 'associations-v1'
const secretKey = config => `token:${config.origin}:${config.sshHost ?? 'direct'}`
async function readPrivateFile(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 4096) fail('invalid_file', 'Choose an absolute local file path.')
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > 65536) fail('invalid_file', 'Choose a file smaller than 64 KiB.')
    return await readFile(path, 'utf8')
  } catch { fail('file_unreadable', 'The selected local file could not be read.') }
}
export default function activate(orca) {
  let revision = 0
  let mutation = Promise.resolve()
  const issuedLinks = new Set()
  function serialize(action) {
    const pending = mutation.then(action)
    mutation = pending.catch(() => {})
    return pending
  }
  async function configuration() {
    const config = await orca.storage.get(CONFIG)
    return config ? parseConfig(config, config.origin) : null
  }
  async function session() {
    const config = await configuration()
    const { status } = await orca.host.call('secrets.protection')
    return {
      configured: !!config, origin: config?.origin ?? '', ...(config?.sshHost ? { sshHost: config.sshHost } : {}), projects: config?.projects ?? [], kinds: Object.keys(config?.operations ?? {}),
      protection: status, credential: !!(config && await orca.secrets.get(secretKey(config)))
    }
  }
  orca.panels.handle('session', session)
  orca.panels.handle('configure', data => serialize(async () => {
    let raw
    try { raw = JSON.parse(await readPrivateFile(data.path)) } catch { fail('invalid_config', 'The configuration file must contain valid JSON.') }
    const config = parseConfig(raw, data.expectedOrigin)
    if ((config.sshHost ?? '') !== (data.expectedSshHost ?? '')) fail('ssh_mismatch', 'Confirm the SSH execution host from your instance configuration.')
    await orca.storage.set(CONFIG, config)
    revision += 1
    issuedLinks.clear()
    return session()
  }))
  orca.panels.handle('credential', data => serialize(async () => {
    const config = await configuration()
    if (!config || secureOrigin(data.expectedOrigin) !== config.origin || (config.sshHost ?? '') !== (data.expectedSshHost ?? '')) fail('origin_mismatch', 'Confirm the configured credential destination.')
    if ((await orca.host.call('secrets.protection')).status !== 'os-keyring') fail('secrets_unavailable', 'Encrypted OS keyring protection is unavailable. A credential cannot be saved.')
    const token = data.path ? (await readPrivateFile(data.path)).trim() : data.token?.trim()
    if (!token || token.length > 8192 || /[\r\n]/.test(token)) fail('invalid_token', 'Provide a valid credential.')
    await orca.secrets.set(secretKey(config), token)
    revision += 1
    return session()
  }))
  orca.panels.handle('forget', () => serialize(async () => {
    const config = await configuration()
    if (config) await orca.secrets.delete(secretKey(config))
    revision += 1
    issuedLinks.clear()
    return session()
  }))
  orca.panels.handle('list', async data => {
    const generation = revision
    const config = await configuration()
    if (!config) return { ok: false, error: { code: 'not_configured', message: 'Import your private instance configuration.', category: 'configuration', retryable: false } }
    const token = await orca.secrets.get(secretKey(config))
    const result = await listItems(config, token ?? '', data.kind, data.project, data.cursor, config.sshHost ? sshTransport(config.sshHost) : undefined)
    if (generation !== revision) return { ok: false, error: { code: 'configuration_changed', message: 'Configuration changed during the request. Refresh the list.', category: 'configuration', retryable: true } }
    if (result.ok) for (const item of result.page.items) if (item.url) issuedLinks.add(item.url)
    return result
  })
  orca.panels.handle('workspaces', async () => {
    const result = await orca.host.call('workspace.list')
    const associations = await orca.storage.get(LINKS) ?? {}
    return { workspaces: result.workspaces.map(w => ({ id: w.id, name: w.name, host: w.hostId ?? 'local' })), truncated: result.truncated, associations }
  })
  orca.panels.handle('associate', data => serialize(async () => {
    const config = await configuration()
    if (!config || !data.url || safeLink(data.url, config.origin) !== data.url || !issuedLinks.has(data.url)) fail('invalid_item', 'Choose an item from the current instance list.')
    const { workspaces } = await orca.host.call('workspace.list')
    if (data.workspaceId && !workspaces.some(w => w.id === data.workspaceId)) fail('missing_workspace', 'Refresh the workspace list and select an available workspace.')
    const links = await orca.storage.get(LINKS) ?? {}
    if (data.workspaceId) links[data.url] = data.workspaceId
    else delete links[data.url]
    await orca.storage.set(LINKS, links)
    return { ok: true }
  }))
  orca.panels.handle('openWorkspace', async data => {
    const { workspaces } = await orca.host.call('workspace.list')
    if (!workspaces.some(w => w.id === data.workspaceId)) fail('missing_workspace', 'The workspace is unavailable. Refresh the workspace list.')
    return orca.host.call('workspace.open', { workspaceId: data.workspaceId })
  })
}
