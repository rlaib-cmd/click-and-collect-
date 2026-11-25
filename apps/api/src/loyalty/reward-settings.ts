import type { LoyaltyProvider } from '@splash360/api-loyalty';
import type { AdminStore } from '@splash360/db';

/**
 * Lot 16 (ADR 0021) : le palier vient du programme de fidélité (Splash360), les catégories de la
 * carte qu'il offre sont réglées par l'enseigne au back-office. Ce décorateur les ajoute au
 * programme, pour tous ses lecteurs (app, devis, contrôle du cadeau à la commande).
 */
export function withRewardCategories(
  provider: LoyaltyProvider,
  settings: Pick<AdminStore, 'listRewardCategories'>,
): LoyaltyProvider {
  return {
    ...provider,
    async getProgram(tenant) {
      const program = await provider.getProgram(tenant);
      if (!program) return program;
      const categories = await settings.listRewardCategories(tenant.id);
      if (categories.size === 0) return program;
      return {
        ...program,
        rewards: program.rewards.map((r) => {
          const ids = categories.get(r.id);
          return ids ? { ...r, categoryIds: ids } : r;
        }),
      };
    },
  };
}
