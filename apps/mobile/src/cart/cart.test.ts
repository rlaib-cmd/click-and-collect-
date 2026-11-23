import { describe, expect, it } from 'vitest';
import {
  cartReducer,
  EMPTY_CART,
  giftAlone,
  itemCount,
  parseStoredCart,
  reorderCart,
  type CartState,
} from './cart';

const add = (
  state: CartState,
  productId: string,
  optionIds: string[] = [],
  quantity = 1,
  note: string | null = null,
  restaurantId = 'r1',
) => cartReducer(state, { type: 'add', restaurantId, productId, optionIds, quantity, note });

describe('panier', () => {
  it('fusionne un même produit avec les mêmes options, quel que soit leur ordre', () => {
    let s = add(EMPTY_CART, 'p', ['a', 'b']);
    s = add(s, 'p', ['b', 'a'], 2);
    expect(s.lines).toHaveLength(1);
    expect(itemCount(s)).toBe(3);
  });

  it('sépare des options ou des notes différentes', () => {
    let s = add(EMPTY_CART, 'p', ['a']);
    s = add(s, 'p', ['b']);
    s = add(s, 'p', ['a'], 1, 'sans oignon');
    expect(s.lines).toHaveLength(3);
  });

  it('vide le panier si on change de restaurant', () => {
    let s = add(EMPTY_CART, 'p');
    s = add(s, 'q', [], 1, null, 'r2');
    expect(s).toMatchObject({ restaurantId: 'r2', lines: [{ productId: 'q' }] });
  });

  it('borne les quantités et retire une ligne à 0', () => {
    let s = add(EMPTY_CART, 'p', [], 150);
    expect(s.lines[0]?.quantity).toBe(99);
    const key = s.lines[0]?.key ?? '';
    s = cartReducer(s, { type: 'setQuantity', key, quantity: 0 });
    expect(s.lines).toEqual([]);
  });

  it("garde les choix de l'accueil quand on vide le panier, et retombe sur « dès que possible » si le créneau est passé", () => {
    let s = cartReducer(EMPTY_CART, {
      type: 'setup',
      restaurantId: 'r1',
      setup: { mode: 'delivery' },
    });
    s = add(s, 'p');
    s = cartReducer(s, { type: 'clear' });
    expect(s.setup.mode).toBe('delivery');
    const stored = JSON.stringify({
      ...s,
      setup: { ...s.setup, time: { kind: 'scheduled', at: '2020-01-01T10:00:00.000Z' } },
    });
    expect(parseStoredCart(stored).setup.time).toEqual({ kind: 'asap' });
  });

  it('relit un panier sauvegardé et ignore les données corrompues', () => {
    const s = add(EMPTY_CART, 'p', ['a'], 2);
    expect(parseStoredCart(JSON.stringify(s))).toEqual(s);
    expect(parseStoredCart('{pas du json')).toEqual(EMPTY_CART);
    expect(parseStoredCart(null)).toEqual(EMPTY_CART);
    const tampered = JSON.stringify({
      restaurantId: 'r1',
      lines: [{ key: 'k', productId: 'p', quantity: -3, optionIds: [], note: null }],
    });
    expect(parseStoredCart(tampered).lines).toEqual([]);
  });
});

describe('cadeau choisi (lot 11)', () => {
  it('garde le cadeau tant que son produit est au panier', () => {
    let s = add(EMPTY_CART, 'frites');
    s = cartReducer(s, { type: 'setReward', reward: { rewardId: 'rw-1', productId: 'frites' } });
    s = add(s, 'burger');
    expect(s.reward).toEqual({ rewardId: 'rw-1', productId: 'frites' });
    const key = s.lines.find((l) => l.productId === 'frites')?.key ?? '';
    s = cartReducer(s, { type: 'remove', key });
    expect(s.reward).toBeNull();
  });

  it('relit le cadeau sauvegardé et ignore une valeur corrompue', () => {
    let s = add(EMPTY_CART, 'frites');
    s = cartReducer(s, { type: 'setReward', reward: { rewardId: 'rw-1', productId: 'frites' } });
    expect(parseStoredCart(JSON.stringify(s)).reward).toEqual({
      rewardId: 'rw-1',
      productId: 'frites',
    });
    expect(parseStoredCart(JSON.stringify({ ...s, reward: { rewardId: 3 } })).reward).toBeNull();
  });

  it('ne reconduit pas le cadeau en recommandant', () => {
    let s = add(EMPTY_CART, 'frites');
    s = cartReducer(s, { type: 'setReward', reward: { rewardId: 'rw-1', productId: 'frites' } });
    expect(reorderCart(s)?.reward).toBeNull();
  });
});

describe('commander comme la dernière fois', () => {
  it('reprend les articles et repasse en « dès que possible »', () => {
    const snapshot = parseStoredCart(
      JSON.stringify({
        restaurantId: 'r1',
        lines: [{ key: 'k', productId: 'bb-original', quantity: 2, optionIds: ['o1'], note: null }],
        setup: {
          mode: 'pickup',
          address: null,
          time: { kind: 'scheduled', at: '2099-01-01T12:00:00.000Z' },
        },
      }),
    );
    expect(reorderCart(snapshot)).toEqual({
      restaurantId: 'r1',
      lines: [{ key: 'k', productId: 'bb-original', quantity: 2, optionIds: ['o1'], note: null }],
      setup: { mode: 'pickup', address: null, time: { kind: 'asap' } },
      reward: null,
    });
  });

  it('ignore un panier vide ou sans restaurant', () => {
    expect(reorderCart(EMPTY_CART)).toBeNull();
  });
});

describe('giftAlone', () => {
  const reward = { rewardId: 'rw', productId: 'frites' };
  const line = (productId: string, quantity: number) => ({
    key: productId,
    productId,
    quantity,
    optionIds: [],
    note: null,
  });
  it('signale un cadeau seul au panier', () => {
    expect(giftAlone({ ...EMPTY_CART, reward, lines: [line('frites', 1)] })).toBe(true);
  });
  it('accepte le cadeau avec un autre article ou une 2e unité', () => {
    expect(
      giftAlone({ ...EMPTY_CART, reward, lines: [line('frites', 1), line('burger', 1)] }),
    ).toBe(false);
    expect(giftAlone({ ...EMPTY_CART, reward, lines: [line('frites', 2)] })).toBe(false);
  });
  it('ignore un panier sans cadeau', () => {
    expect(giftAlone({ ...EMPTY_CART, lines: [line('frites', 1)] })).toBe(false);
  });
});
