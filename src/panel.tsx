import { atom, read, set, Stack, Row, Heading, Button, Input, Select, Table, Text, Callout, EmptyState, Collapsible, Spinner, Link, plugin, type PanelContext } from 'orca'
import type { Session, Item, Kind, Failure, Workspace, Associations } from './protocol'

const session = atom<Session | null>(null)
const items = atom<Item[]>([])
const kind = atom<Kind>('mr')
const project = atom('')
const next = atom<string | null>(null)
const busy = atom(false)
const error = atom<Failure | null>(null)
const notice = atom('')
const selected = atom('')
const workspaces = atom<Workspace[]>([])
const truncated = atom(false)
const associations = atom<Associations>({})
const workspace = atom('')
const origin = atom('')
const configPath = atom('')
const tokenPath = atom('')
const token = atom('')
const settings = atom(false)
let generation = 0

async function refreshWorkspaces(): Promise<void> {
  const result = await plugin.request('workspaces')
  set(workspaces, result.workspaces)
  set(truncated, result.truncated)
  set(associations, result.associations)
}
function showError(): void { set(notice, 'The operation failed. Check the instance configuration or host availability.') }
async function load(more = false): Promise<void> {
  const current = ++generation
  set(busy, true)
  set(error, null)
  set(notice, '')
  if (!more) { set(items, []); set(next, null); set(selected, ''); set(workspace, '') }
  try {
    const result = await plugin.request('list', { kind: read(kind), project: read(project), cursor: more ? read(next) : null })
    if (current !== generation) return
    if (result.ok) {
      const merged = more ? [...read(items), ...result.page.items] : result.page.items
      set(items, [...new Map(merged.map(i => [i.id, i])).values()])
      set(next, result.page.next)
    } else set(error, result.error)
  } catch { if (current === generation) showError() }
  finally { if (current === generation) set(busy, false) }
}
async function acceptSession(value: Session): Promise<void> {
  set(session, value)
  set(origin, value.origin)
  set(settings, !value.configured || !value.credential)
  set(project, value.projects[0]?.id ?? '')
  set(kind, value.kinds.includes('mr') ? 'mr' : 'issue')
  generation += 1
  set(items, []); set(next, null); set(selected, ''); set(busy, false)
  if (value.configured && value.credential) await load()
}
async function configure(): Promise<void> {
  try { await acceptSession(await plugin.request('configure', { path: read(configPath), expectedOrigin: read(origin) })); set(configPath, '') }
  catch { set(notice, 'Configuration import failed. Check the file, schema and explicitly confirmed origin.') }
}
async function saveCredential(): Promise<void> {
  try {
    const result = await plugin.request('credential', { path: read(tokenPath) || undefined, token: read(token) || undefined, expectedOrigin: read(origin) })
    await acceptSession(result)
  } catch { set(notice, 'Credential import failed. Confirm the origin, input and OS keyring protection.') }
  finally { set(token, ''); set(tokenPath, '') }
}
async function forget(): Promise<void> {
  try { await acceptSession(await plugin.request('forget')) } catch { showError() }
}
async function associate(): Promise<void> {
  const item = read(items).find(i => i.id === read(selected))
  if (!item?.url) return
  try {
    await plugin.request('associate', { url: item.url, workspaceId: read(workspace) })
    await refreshWorkspaces()
    set(notice, read(workspace) ? 'Workspace association saved.' : 'Workspace association removed.')
  } catch { set(notice, 'Association failed. Refresh the workspace list and retry.') }
}
async function openWorkspace(): Promise<void> {
  try { await plugin.request('openWorkspace', { workspaceId: read(workspace) }) } catch { showError() }
}
export function setup(ctx: PanelContext): void {
  void plugin.request('session').then(acceptSession).catch(showError)
  void refreshWorkspaces().catch(showError)
  ctx.subscriptions.push({ dispose: () => { generation += 1; set(token, '') } })
}
export default function Panel() {
  const state = read(session)
  const active = read(items).find(i => i.id === read(selected))
  const failure = read(error)
  return <Stack gap="md">
    <Row justify="between">
      <Heading>NextCode</Heading>
      <Button variant="ghost" icon="settings" onPress={() => set(settings, !read(settings))}>Connection</Button>
    </Row>
    {!state && <Spinner label="Reading connection" />}
    <Collapsible title="Instance configuration" open={read(settings)} onChange={v => set(settings, v)}>
      <Stack gap="sm">
        <Text muted size="sm">Import a private JSON configuration from this Orca host. Use your authorized instance’s API documentation.</Text>
        <Input label="Confirmed HTTPS origin" placeholder="https://nextcode.example.com" value={read(origin)} onChange={v => set(origin, v)} />
        <Input label="Configuration file" placeholder="/absolute/path/instance.json" value={read(configPath)} onChange={v => set(configPath, v)} />
        <Button disabled={!read(configPath) || !read(origin)} onPress={configure}>Import configuration</Button>
        {state?.configured && <Text size="sm">Credential destination {state.origin}</Text>}
        {state?.sshHost && <Text size="sm">Request host {state.sshHost} (SSH)</Text>}
        <Input label="Credential" type="password" value={read(token)} onChange={v => set(token, v)} />
        <Input label="Or local credential file" value={read(tokenPath)} placeholder="/absolute/path/credential" onChange={v => set(tokenPath, v)} />
        <Text muted size="xs">Protection {state?.protection ?? 'checking'} · {state?.credential ? 'credential saved' : 'credential needed'}</Text>
        <Row gap="sm">
          <Button disabled={!state?.configured || state.protection !== 'os-keyring' || (!read(token) && !read(tokenPath))} onPress={saveCredential}>Save credential</Button>
          <Button variant="ghost" disabled={!state?.credential} onPress={forget}>Forget credential</Button>
        </Row>
      </Stack>
    </Collapsible>
    {state?.configured && <Stack gap="sm">
      <Select label="Project" value={read(project)} options={state.projects.map(p => ({ value: p.id, label: p.label }))} onChange={v => { set(project, v); void load() }} />
      <Row justify="between" gap="sm">
        <Select label="Items" value={read(kind)} options={[{ value: 'mr', label: 'Merge requests', disabled: !state.kinds.includes('mr') }, { value: 'issue', label: 'Issues', disabled: !state.kinds.includes('issue') }]} onChange={v => { set(kind, v as Kind); void load() }} />
        <Button icon="refresh" disabled={read(busy) || !state.credential} onPress={() => load()}>Refresh</Button>
      </Row>
      {!state.kinds.includes('issue') && <Text muted size="xs">Issue API support requires an authorized mapping in your instance configuration.</Text>}
      {failure && <Callout tone="danger" title={failure.category === 'policy' ? 'Authentication policy error' : 'Request failed'}>
        <Text>{failure.message}</Text><Text muted size="xs">{failure.code}</Text>
        <Button variant="ghost" onPress={() => load(!!read(items).length)}>Retry</Button>
      </Callout>}
      <Table label="NextCode items" columns={[{ key: 'number', label: 'Number', width: 'xs' }, { key: 'title', label: 'Title' }, { key: 'status', label: 'Status', width: 'sm' }]} rows={read(items).map(i => ({ key: i.id, cells: { number: i.number, title: i.title, status: i.status } }))} selectionMode="single" selected={read(selected) ? [read(selected)] : []} loading={read(busy)} hasMore={!!read(next)} emptyText={failure ? 'The request failed.' : 'No items returned.'} onLoadMore={() => load(true)} onSelectionChange={v => {
        const id = v.keys[0] ?? ''
        set(selected, id)
        const item = read(items).find(i => i.id === id)
        set(workspace, item ? read(associations)[item.url] ?? '' : '')
      }} />
      {read(next) && <Button disabled={read(busy)} onPress={() => load(true)}>Load more</Button>}
    </Stack>}
    {active && <Stack gap="sm">
      <Heading level={3}>{active.title}</Heading>
      {active.url ? <Link href={active.url}>Open original details</Link> : <Text tone="warning">A safe same-origin details link was unavailable.</Text>}
      <Select label="Orca workspace" value={read(workspace) || '__none__'} options={[{ value: '__none__', label: 'No association' }, ...read(workspaces).slice(0, 499).map(w => ({ value: w.id, label: `${w.name} · ${w.host}` }))]} onChange={v => set(workspace, v === '__none__' ? '' : v)} />
      <Row gap="sm" wrap>
        <Button disabled={!active.url} onPress={associate}>Save association</Button>
        <Button variant="ghost" disabled={!read(workspace)} onPress={openWorkspace}>Open workspace</Button>
        <Button variant="ghost" onPress={() => refreshWorkspaces().catch(showError)}>Refresh workspaces</Button>
      </Row>
      {(read(truncated) || read(workspaces).length > 499) && <Text tone="warning" size="xs">Workspace results are truncated. Some workspaces may be unavailable in this selector.</Text>}
    </Stack>}
    {read(notice) && <Callout tone="neutral"><Text>{read(notice)}</Text></Callout>}
    {state && !state.configured && <EmptyState title="Connect your instance" description="Import your private API mappings and configure an origin-bound credential." icon="plug" />}
  </Stack>
}
