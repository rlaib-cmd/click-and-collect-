import { formatCents } from './format';

const STATUS_TEXT: Record<string, { title: string; body: string } | undefined> = {
  paid: {
    title: 'Commande confirmée',
    body: 'Votre paiement est reçu. Nous transmettons votre commande au restaurant.',
  },
  accepted: { title: 'Commande acceptée', body: 'Le restaurant a accepté votre commande.' },
  preparing: { title: 'En préparation', body: 'Votre commande est en cours de préparation.' },
  ready: { title: 'Commande prête', body: 'Votre commande est prête.' },
  out_for_delivery: { title: 'En livraison', body: 'Votre commande est en route.' },
  completed: { title: 'Bon appétit !', body: 'Votre commande a été remise. Merci !' },
  cancelled: {
    title: 'Commande annulée',
    body: 'Votre commande a été annulée. Vous serez remboursé si vous avez été débité.',
  },
};

export function statusNotification(status: string, number: number, tenantName: string) {
  const text = STATUS_TEXT[status];
  return text
    ? { title: `${tenantName} · ${text.title}`, body: `Commande n° ${number}. ${text.body}` }
    : null;
}

/** E-mail de confirmation avec le reçu (texte simple ; mise en forme HTML à prévoir avec le prestataire). */
export function receiptEmail(input: {
  tenantName: string;
  number: number;
  lines: readonly {
    name: string;
    quantity: number;
    totalCents: number;
    options: readonly { name: string }[];
  }[];
  totals: {
    subtotalCents: number;
    deliveryFeeCents: number;
    serviceFeeCents: number;
    totalCents: number;
  };
}) {
  const lines = input.lines.map(
    (l) =>
      `${l.quantity} × ${l.name}${l.options.length ? ` (${l.options.map((o) => o.name).join(', ')})` : ''} — ${formatCents(l.totalCents)}`,
  );
  const totals = [
    `Sous-total : ${formatCents(input.totals.subtotalCents)}`,
    ...(input.totals.deliveryFeeCents
      ? [`Livraison : ${formatCents(input.totals.deliveryFeeCents)}`]
      : []),
    ...(input.totals.serviceFeeCents
      ? [`Frais de service : ${formatCents(input.totals.serviceFeeCents)}`]
      : []),
    `Total payé : ${formatCents(input.totals.totalCents)}`,
  ];
  return {
    subject: `${input.tenantName} · Confirmation de votre commande n° ${input.number}`,
    text: [`Merci pour votre commande n° ${input.number}.`, '', ...lines, '', ...totals].join('\n'),
  };
}
