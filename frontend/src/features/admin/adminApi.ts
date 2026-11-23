import { request, writeRequest } from '../../api/client'
import type { paths } from '../../api/generated/openapi'

type ReadSuccess<Path extends keyof paths, Method extends 'get' | 'post' | 'put'> =
  paths[Path] extends Record<Method, { responses: { 200: { content: { 'application/json': { data: infer Data } } } } }>
    ? Data : never

type WriteBody<Path extends keyof paths, Method extends 'post' | 'put'> =
  paths[Path] extends Record<Method, { requestBody: { content: { 'application/json': infer Data } } }>
    ? Data : never

export type Source = ReadSuccess<'/api/v1/admin/sources', 'get'>[number]
export type SourceInput = WriteBody<'/api/v1/admin/sources', 'post'>
export type SourceOptions = ReadSuccess<'/api/v1/admin/source-options', 'get'>
export type SourceAsset = ReadSuccess<'/api/v1/admin/source-assets', 'post'>
export type ConnectionTest = ReadSuccess<'/api/v1/admin/sources/{id}/connection-tests', 'post'>
export type SyncRun = ReadSuccess<'/api/v1/admin/sources/{id}/sync-runs', 'get'>[number]
export type SourceDataset = ReadSuccess<'/api/v1/admin/sources/{id}/dataset', 'get'>
export type Metric = ReadSuccess<'/api/v1/admin/metrics', 'get'>[number]
export type MetricInput = WriteBody<'/api/v1/admin/metrics', 'post'>

const admin = '/api/v1/admin'
const sources = admin + '/sources'
const metrics = admin + '/metrics'
const sourcePath = (id: string) => sources + '/' + encodeURIComponent(id)
const metricPath = (id: string) => metrics + '/' + encodeURIComponent(id)
const versionHeader = (version: number) => ({ 'If-Match': '"' + version + '"' })

export const adminQueryKeys = {
  sources: ['admin', 'sources'] as const,
  options: ['admin', 'source-options'] as const,
  runs: (id: string) => ['admin', 'source-runs', id] as const,
  dataset: (id: string, batchId: string | null) => ['admin', 'source-dataset', id, batchId] as const,
  metrics: ['admin', 'metrics'] as const,
}

export const adminApi = {
  sources: (signal: AbortSignal) => request<Source[]>(sources, { signal }),
  sourceOptions: (signal: AbortSignal) => request<SourceOptions>(admin + '/source-options', { signal }),
  createSource: (body: SourceInput) => writeRequest<Source>(sources, 'POST', { body }),
  updateSource: (body: SourceInput, version: number) =>
    writeRequest<Source>(sourcePath(body.id), 'PUT', { body, headers: versionHeader(version) }),
  uploadCsv: (file: File) => {
    const body = new FormData()
    body.set('file', file)
    return writeRequest<SourceAsset>(admin + '/source-assets', 'POST', { body })
  },
  connectionTest: (id: string) =>
    writeRequest<ConnectionTest>(sourcePath(id) + '/connection-tests', 'POST'),
  dataset: (id: string, signal: AbortSignal) => request<SourceDataset>(sourcePath(id) + '/dataset', { signal }),
  runs: (id: string, signal: AbortSignal) =>
    request<SyncRun[]>(sourcePath(id) + '/sync-runs', { signal }),
  synchronize: (id: string, key: string, retryOf?: string) =>
    writeRequest<SyncRun>(sourcePath(id) + '/sync-runs', 'POST', {
      body: retryOf ? { retryOf } : undefined,
      headers: { 'Idempotency-Key': key },
    }),
  metrics: (signal: AbortSignal) => request<Metric[]>(metrics, { signal }),
  createMetric: (body: MetricInput) => writeRequest<Metric>(metrics, 'POST', { body }),
  updateMetric: (body: MetricInput, revision: number) =>
    writeRequest<Metric>(metricPath(body.id), 'PUT', { body, headers: versionHeader(revision) }),
  publishMetric: (id: string, revision: number) =>
    writeRequest<Metric>(metricPath(id) + '/publish', 'POST', { headers: versionHeader(revision) }),
}
