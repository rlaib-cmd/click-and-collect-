import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useTenant } from '@/tenant/TenantProvider';
import {
  cartReducer,
  EMPTY_CART,
  itemCount,
  parseStoredCart,
  type CartAction,
  type CartState,
} from './cart';

interface CartContextValue {
  readonly cart: CartState;
  readonly count: number;
  readonly dispatch: (action: CartAction) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart doit être utilisé sous <CartProvider>');
  return value;
}

/** Panier de l'enseigne, conservé après fermeture de l'application (section 8, Robustesse). */
export function CartProvider({ children }: { children: ReactNode }) {
  const { config } = useTenant();
  const storageKey = `cart:${config.tenant.subdomain}`;
  const [cart, dispatch] = useReducer(cartReducer, EMPTY_CART);
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!cancelled) dispatch({ type: 'restore', state: parseStoredCart(raw) });
      })
      .catch(() => undefined)
      .finally(() => {
        restored.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!restored.current) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(cart)).catch(() => undefined);
  }, [cart, storageKey]);

  const value = useMemo(() => ({ cart, count: itemCount(cart), dispatch }), [cart]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
