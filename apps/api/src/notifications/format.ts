const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function formatCents(cents: number): string {
  return euros.format(cents / 100).replace(/\u202f|\u00a0/g, ' ');
}
