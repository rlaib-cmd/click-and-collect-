import AsyncStorage from '@react-native-async-storage/async-storage';

/** Commandes passées sur cet appareil, avec leur jeton de suivi (jamais envoyé ailleurs qu'à l'API). */
export interface SavedOrder {
  readonly orderId: string;
  readonly number: number;
  readonly accessToken: string;
  readonly createdAt: string;
}

const key = (subdomain: string) => `orders:${subdomain}`;
const MAX_KEPT = 20;

export async function listSavedOrders(subdomain: string): Promise<SavedOrder[]> {
  try {
    const raw = await AsyncStorage.getItem(key(subdomain));
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data)
      ? data.filter(
          (o): o is SavedOrder =>
            typeof o === 'object' &&
            o !== null &&
            typeof (o as SavedOrder).orderId === 'string' &&
            typeof (o as SavedOrder).accessToken === 'string' &&
            typeof (o as SavedOrder).number === 'number',
        )
      : [];
  } catch {
    return [];
  }
}

export async function saveOrder(subdomain: string, order: SavedOrder): Promise<void> {
  const list = (await listSavedOrders(subdomain)).filter((o) => o.orderId !== order.orderId);
  await AsyncStorage.setItem(key(subdomain), JSON.stringify([order, ...list].slice(0, MAX_KEPT)));
}

export async function findSavedOrder(
  subdomain: string,
  orderId: string,
): Promise<SavedOrder | null> {
  return (await listSavedOrders(subdomain)).find((o) => o.orderId === orderId) ?? null;
}
