import { PARTNER_ERASURE_DAYS } from '@splash360/contracts';
import { messages } from '@splash360/i18n';

const t = messages.accountDeletion;

/** Issue d'une suppression réussie : avec ou sans effacement demandé chez le partenaire. */
export type DeletionOutcome = 'deleted' | 'deleted_partner';

export interface DeletionSteps {
  /** DELETE /loyalty/me ; lève une erreur si le serveur n'a pas confirmé. */
  readonly request: () => Promise<void>;
  /** Arrêt de la surveillance des zones « à proximité » et de l'état local associé. */
  readonly stopProximity: () => Promise<void>;
  /** Déconnexion locale : jeton effacé de l'appareil. */
  readonly logout: () => void;
}

/**
 * « Supprimer mon compte » (ADR 0028) : rien ne change sur l'appareil tant que le serveur n'a pas
 * confirmé ; ensuite, les bons plans à proximité s'arrêtent et la session locale est effacée.
 */
export async function deleteAccount(
  steps: DeletionSteps,
  partnerErasure: boolean,
): Promise<DeletionOutcome> {
  await steps.request();
  // Le compte est effacé côté serveur (appareils « à proximité » compris) : un échec local de
  // l'arrêt de la surveillance n'empêche ni la déconnexion ni le message de confirmation.
  await steps.stopProximity().catch(() => undefined);
  steps.logout();
  return partnerErasure ? 'deleted_partner' : 'deleted';
}

/** Message montré à l'accueil après la suppression. */
export function farewellMessage(outcome: DeletionOutcome): string {
  return outcome === 'deleted_partner' ? t.donePartner(PARTNER_ERASURE_DAYS) : t.done;
}

/** Textes de l'écran de confirmation : conséquences, puis le partenaire s'il y en a un. */
export function deletionConsequences(partnerErasure: boolean): readonly string[] {
  return partnerErasure ? [...t.consequences, t.partner(PARTNER_ERASURE_DAYS)] : t.consequences;
}
