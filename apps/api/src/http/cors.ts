/** `CORS_ORIGINS` : liste d'origines exactes ; vide ou absente → toutes (`*`). */
export function corsOriginsFrom(raw: string | undefined): readonly string[] | '*' {
  const list = (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => /^https?:\/\/[^/\s]+$/.test(o));
  return list.length > 0 ? list : '*';
}
