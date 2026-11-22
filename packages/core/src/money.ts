/**
 * Montants en centimes d'euro (entiers). Jamais de nombres à virgule pour l'argent.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Montant invalide : ${value} n'est pas un nombre entier de centimes`);
  }
  return value as Cents;
}

export function addCents(...amounts: readonly Cents[]): Cents {
  return cents(amounts.reduce<number>((total, amount) => total + amount, 0));
}

export function multiplyCents(amount: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantité invalide : ${quantity}`);
  }
  return cents(amount * quantity);
}
