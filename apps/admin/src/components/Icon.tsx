/** Icônes au trait du studio (couleur du texte). Décoratives : le libellé est toujours à côté. */
export type IconName =
  | 'home'
  | 'palette'
  | 'burger'
  | 'gift'
  | 'tag'
  | 'store'
  | 'orders'
  | 'chart'
  | 'users'
  | 'team'
  | 'card'
  | 'journal'
  | 'grid'
  | 'pause'
  | 'phone'
  | 'check'
  | 'back'
  | 'edit'
  | 'info'
  | 'arrow'
  | 'logout';

const PATHS: Record<IconName, string[]> = {
  home: ['M3 11l9-8 9 8v10h-6v-6H9v6H3z'],
  palette: [
    'M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 10c0-4.4-4.5-8-10-8z',
    'M13.5 6.5h.01M8.5 7.5h.01M17.5 10.5h.01',
  ],
  burger: ['M4 10c0-4 4-6 8-6s8 2 8 6z', 'M3 14h18M4 18h16c0 1-1 2-2 2H6c-1 0-2-1-2-2z'],
  gift: ['M3 8h18v4H3zM5 12v9h14v-9M12 8v13', 'M12 8c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1'],
  tag: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', 'M7.5 7.5h.01'],
  store: ['M3 21h18M5 21V7l7-4 7 4v14', 'M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4'],
  orders: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'],
  chart: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  users: [
    'M2 21c0-4 3-6 7-6s7 2 7 6',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5',
  ],
  team: ['M2 21c0-4 3-6 7-6s7 2 7 6', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6M16 11h6'],
  card: ['M2 6h20v12H2z', 'M2 10h20'],
  journal: ['M5 3h11l3 3v15H5z', 'M9 9h6M9 13h6M9 17h4'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  pause: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M10 9v6M14 9v6'],
  phone: ['M6 2h12v20H6z', 'M11 18h2'],
  check: ['M5 12l5 5L20 7'],
  back: ['M15 18l-6-6 6-6'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 8h.01M11 12h1v5h1'],
  arrow: ['M5 12h14M13 6l6 6-6 6'],
  logout: ['M9 21H5V3h4', 'M16 17l5-5-5-5M21 12H9'],
};

export function Icon({
  name,
  size = 20,
  color = 'currentColor',
  stroke = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
