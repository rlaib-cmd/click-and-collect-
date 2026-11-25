/**
 * Date de naissance saisie au format français (lot 16) : « JJ/MM/AAAA » ↔ « AAAA-MM-JJ ».
 * Le contrôle final (bornes 1900 → aujourd'hui) reste fait par le serveur.
 */

/** '' → null (champ vidé) ; date invalide → 'invalid' ; sinon la date ISO. */
export function parseFrenchDate(text: string): string | null | 'invalid' {
  const value = text.trim();
  if (value === '') return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (!m) return 'invalid';
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return 'invalid';
  const iso = date.toISOString().slice(0, 10);
  if (iso < '1900-01-01' || iso > new Date().toISOString().slice(0, 10)) return 'invalid';
  return iso;
}

/** « AAAA-MM-JJ » → « JJ/MM/AAAA » (affichage dans le formulaire). */
export function formatFrenchDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** Ajoute les « / » pendant la saisie au clavier numérique : 01021990 → 01/02/1990. */
export function maskFrenchDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
