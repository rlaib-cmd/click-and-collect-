## Quoi et pourquoi

## Lot et critère d'acceptation concernés

## Vérifications

- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
- [ ] Toute nouvelle table : `tenant_id`, RLS, test dans `supabase/tests/`
- [ ] Aucun montant calculé côté application, aucun secret côté client
- [ ] Décision structurante tracée dans un ADR
