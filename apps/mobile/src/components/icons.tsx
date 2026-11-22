import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Icônes de la barre d'onglets, en trait (couleur au choix de l'appelant). */
export type IconName = 'home' | 'gift' | 'burger' | 'qr' | 'user';

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
      {name === 'user' ? (
        <>
          <Circle cx={12} cy={8} r={4} {...common} />
          <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" {...common} />
        </>
      ) : null}
    </Svg>
  );
}
