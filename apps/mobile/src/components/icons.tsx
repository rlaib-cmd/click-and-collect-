import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Icônes de la barre d'onglets, en trait (couleur au choix de l'appelant). */
export type IconName =
  | 'home'
  | 'gift'
  | 'burger'
  | 'qr'
  | 'user'
  | 'crown'
  | 'star'
  | 'lock'
  | 'receipt'
  | 'tag'
  | 'card'
  | 'help'
  | 'logout'
  | 'chevron'
  | 'store';

export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const common = { stroke: color, strokeWidth: 2, fill: 'none' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {name === 'home' ? <Path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z" {...common} /> : null}
      {name === 'gift' ? (
        <>
          <Rect x={3} y={8} width={18} height={13} rx={2} {...common} />
          <Path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1" {...common} />
        </>
      ) : null}
      {name === 'burger' ? (
        <>
          <Path d="M4 10c0-4 4-6 8-6s8 2 8 6z" {...common} />
          <Path d="M3 14h18M4 18h16c0 1-1 2-2 2H6c-1 0-2-1-2-2z" {...common} />
        </>
      ) : null}
      {name === 'qr' ? (
        <>
          <Rect x={3} y={3} width={7} height={7} {...common} />
          <Rect x={14} y={3} width={7} height={7} {...common} />
          <Rect x={3} y={14} width={7} height={7} {...common} />
          <Path d="M14 14h3v3h-3zM20 14v7M14 20h3" {...common} />
        </>
      ) : null}
      {name === 'store' ? (
        <>
          <Path
            d="M4 9l1.5-5h13L20 9M4 9h16v2a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 11z"
            {...common}
            strokeLinejoin="round"
          />
          <Path d="M5 13v8h14v-8M10 21v-5h4v5" {...common} />
        </>
      ) : null}
      {name === 'crown' ? (
        <Path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" {...common} strokeLinejoin="round" />
      ) : null}
      {name === 'star' ? (
        <Path
          d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
          {...common}
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'lock' ? (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...common} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...common} />
        </>
      ) : null}
      {name === 'receipt' ? (
        <Path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" {...common} />
      ) : null}
      {name === 'tag' ? (
        <>
          <Path d="M3 12V4h8l10 10-8 8z" {...common} strokeLinejoin="round" />
          <Circle cx={7.5} cy={8.5} r={1.5} {...common} />
        </>
      ) : null}
      {name === 'card' ? (
        <>
          <Rect x={3} y={6} width={18} height={13} rx={2} {...common} />
          <Path d="M3 10h18M7 15h4" {...common} />
        </>
      ) : null}
      {name === 'help' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...common} />
          <Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" {...common} />
        </>
      ) : null}
      {name === 'logout' ? (
        <Path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" {...common} strokeLinejoin="round" />
      ) : null}
      {name === 'chevron' ? <Path d="M9 5l7 7-7 7" {...common} /> : null}
      {name === 'user' ? (
        <>
          <Circle cx={12} cy={8} r={4} {...common} />
          <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" {...common} />
        </>
      ) : null}
    </Svg>
  );
}
