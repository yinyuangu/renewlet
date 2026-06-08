export function websitePath(path = '', baseUrl = import.meta.env.BASE_URL) {
  const base = baseUrl ? baseUrl : '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.replace(/^\/+/, '')

  return `${normalizedBase}${normalizedPath}`
}
