# Sécurité

## Signaler une faille

Écrire à l'équipe technique Splash360 (adresse à définir) sans ouvrir de ticket public. Réponse sous 72 h.

## Principes appliqués dans ce dépôt

- Aucune donnée de carte ne transite par nos serveurs : seuls les composants Stripe la manipulent.
- Secrets uniquement en variables d'environnement serveur ; jamais dans les applications ni dans Git.
- Cloisonnement par enseigne : `tenant_id` sur chaque table, RLS activée, filtrage systématique côté serveur, tests dédiés.
- Webhooks vérifiés par signature et traités de façon idempotente.
- Dépendances surveillées par Dependabot ; correctifs de sécurité appliqués sous 7 jours.
