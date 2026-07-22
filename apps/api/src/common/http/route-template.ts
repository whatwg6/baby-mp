import type { RequestWithContext } from './request-context'

export function routeTemplateFrom(request: RequestWithContext): string {
  const route = request.route as { path?: unknown } | undefined
  if (typeof route?.path !== 'string') return 'unmatched'

  const routePath = route.path.startsWith('/') ? route.path : `/${route.path}`
  return routePath.startsWith('/api/v1/')
    ? routePath
    : `/api/v1${routePath}`
}
