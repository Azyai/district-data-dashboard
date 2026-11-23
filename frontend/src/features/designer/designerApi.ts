import { request, writeRequest } from '../../api/client'
import type { components, paths } from '../../api/generated/openapi'

type DraftPath = paths['/api/v1/admin/dashboards/{projectId}/draft']
type DraftComponent = components['schemas']['DashboardDraftComponent']
type DraftState = DraftPath['put']['responses'][200]['content']['application/json']['data']
export type DraftWorkspace = DraftPath['get']['responses'][200]['content']['application/json']['data']

function draftPath(projectId: string) {
  return '/api/v1/admin/dashboards/' + encodeURIComponent(projectId) + '/draft'
}

export const designerApi = {
  draft: (projectId: string, signal?: AbortSignal) => request<DraftWorkspace>(draftPath(projectId), { signal }),
  save: (projectId: string, revision: number, components: DraftComponent[]) =>
    writeRequest<DraftState>(draftPath(projectId), 'PUT', {
      body: { components },
      headers: { 'If-Match': '"' + revision + '"' },
    }),
}
