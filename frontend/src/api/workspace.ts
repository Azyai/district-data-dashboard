export const managementWorkspaceHeader = 'X-Dashboard-Workspace'

export function workspaceForPath(pathname: string) {
  return /^\/admin(?:\/|$)/i.test(pathname) ? 'management' : 'display'
}
