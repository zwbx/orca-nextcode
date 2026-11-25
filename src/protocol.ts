export type Kind = 'mr' | 'issue'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface Operation {
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string>
  body?: Json
  items: string
  fields: { id: string; number: string; title: string; status: string; url: string }
  pagination?: { mode: 'cursor' | 'page'; next?: string; hasMore?: string; total?: string; start?: number }
}
export interface InstanceConfig {
  version: 1
  origin: string
  sshHost?: string
  auth: { header: string; prefix: string }
  projects: { id: string; label: string }[]
  operations: Partial<Record<Kind, Operation>>
  error?: { path: string; code: string; message: string; policyPatterns?: string[] }
  pageSize?: number
}
export interface Item { id: string; number: string; title: string; status: string; url: string }
export interface Page { items: Item[]; next: string | null }
export interface Failure { code: string; message: string; category: 'configuration' | 'authentication' | 'policy' | 'permission' | 'network' | 'response'; retryable: boolean }
export type ListResult = { ok: true; page: Page } | { ok: false; error: Failure }
export interface Workspace { id: string; name: string; host: string }
export interface Session {
  configured: boolean; origin: string; sshHost?: string; projects: { id: string; label: string }[]; kinds: Kind[]
  protection: 'os-keyring' | 'unavailable'; credential: boolean
}
export interface Associations { [url: string]: string }
declare module 'orca' {
  interface PluginRequests {
    'session': { output: Session }
    'configure': { input: { path: string; expectedOrigin: string; expectedSshHost?: string }; output: Session }
    'credential': { input: { path?: string; token?: string; expectedOrigin: string; expectedSshHost?: string }; output: Session }
    'forget': { output: Session }
    'list': { input: { kind: Kind; project: string; cursor: string | null }; output: ListResult }
    'workspaces': { output: { workspaces: Workspace[]; truncated: boolean; associations: Associations } }
    'associate': { input: { url: string; workspaceId: string }; output: { ok: true } }
    'openWorkspace': { input: { workspaceId: string }; output: { opened: true } }
  }
}
