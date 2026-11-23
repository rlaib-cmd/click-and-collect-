'use client';

import type { TenantThemeDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { buildPalette, isHexColor, radiiFor, type Palette } from '@splash360/theme';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { PreviewData, PreviewProduct } from '@/lib/preview-data';

const t = messages.admin.design;
const l = messages.loyalty;

type Tab = 'home' | 'menu' | 'card' | 'rewards';

/** Points du membre fictif de l'aperçu : assez pour débloquer le premier palier. */
const DEMO_POINTS = 650;

const price = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')}\u00a0€`;

/**
 * Aperçu du brouillon dans un cadre de téléphone (lot 12) : mêmes règles de palette, de contraste,
 * d'angles et de titres que l'application (`@splash360/theme`), avec la vraie carte de l'enseigne.
 */
export function PhonePreview({
  theme,
  tenantName,
  data,
}: {
  theme: TenantThemeDto;
  tenantName: string;
  data: PreviewData;
}) {
  const [tab, setTab] = useState<Tab>('home');
  const palette = buildPalette({
    primaryColor: isHexColor(theme.primaryColor) ? theme.primaryColor : '#1F6FEB',
    mode: theme.mode,
    loyaltyColor: theme.loyaltyColor && isHexColor(theme.loyaltyColor) ? theme.loyaltyColor : null,
  });
  const radii = radiiFor(theme.style.corners);
  const title: CSSProperties = theme.style.uppercaseTitles
    ? { textTransform: 'uppercase', fontWeight: 900, letterSpacing: 0.3 }
    : { fontWeight: 800 };
  const ctx: Ctx = { theme, palette, radii, title, tenantName, data };

  return (
    <div className="pv">
      <div className="pv-tabs" role="tablist" aria-label={t.previewLabel}>
        {(Object.keys(t.previewTabs) as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'pv-tab active' : 'pv-tab'}
            onClick={() => setTab(k)}
          >
            {t.previewTabs[k]}
          </button>
        ))}
      </div>
      <div className="pv-phone" aria-label={t.previewLabel}>
        <div className="pv-screen" style={{ background: palette.background, color: palette.text }}>
          <div className="pv-scroll">
            {tab === 'home' ? <Home {...ctx} /> : null}
            {tab === 'menu' ? <MenuScreen {...ctx} /> : null}
            {tab === 'card' ? <CardScreen {...ctx} /> : null}
            {tab === 'rewards' ? <Rewards {...ctx} /> : null}
          </div>
          <TabBar {...ctx} tab={tab} onTab={setTab} />
        </div>
      </div>
    </div>
  );
}

interface Ctx {
  theme: TenantThemeDto;
  palette: Palette;
  radii: ReturnType<typeof radiiFor>;
  title: CSSProperties;
  tenantName: string;
  data: PreviewData;
}

function Logo({ theme, palette, tenantName, wide }: Ctx & { wide: boolean }) {
  if (theme.logoUrl)
    return <img src={theme.logoUrl} alt="" className={wide ? 'pv-logo-wide' : 'pv-logo'} />;
  return (
    <div
      className="pv-logo pv-monogram"
      style={{ background: palette.primary, color: palette.onPrimary }}
    >
      {tenantName.trim().charAt(0).toUpperCase()}
    </div>
  );
}

function Header(props: Ctx & { children?: ReactNode; compact?: boolean }) {
  const { theme, palette, title, tenantName, children, compact } = props;
  const brand = theme.style.header === 'brand';
  return (
    <>
      <div
        className={compact ? 'pv-head compact' : 'pv-head'}
        style={
          brand
            ? { background: palette.primary, color: palette.onPrimary }
            : { borderBottom: `1px solid ${palette.border}` }
        }
      >
        {children}
        <Logo {...props} wide={brand && Boolean(theme.logoUrl)} />
        {!compact && (!brand || !theme.logoUrl) ? (
          <strong style={{ ...title, fontSize: 18 }}>{tenantName}</strong>
        ) : null}
        {!compact && theme.tagline ? (
          <span
            style={{ ...title, fontSize: 12, color: brand ? palette.onPrimary : palette.textMuted }}
          >
            {theme.tagline}
          </span>
        ) : null}
      </div>
      {brand && theme.style.pattern === 'checker' ? <Checker palette={palette} /> : null}
    </>
  );
}

function Checker({ palette }: { palette: Palette }) {
  return (
    <div
      className="pv-checker"
      aria-hidden
      style={{
        backgroundImage: `repeating-conic-gradient(${palette.primary} 0 25%, ${palette.onPrimary} 0 50%)`,
      }}
    />
  );
}

function LoyaltyCard({ palette, radii, title, data }: Ctx) {
  const next = data.tiers.find((tier) => tier.costPoints > DEMO_POINTS) ?? null;
  const image = next?.products[0]?.imageUrl ?? null;
  const progress = next ? Math.min(1, DEMO_POINTS / next.costPoints) : 1;
  return (
    <div
      className="pv-card"
      style={{
        background: palette.surface,
        borderRadius: radii.card + 4,
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className="pv-row">
        <strong style={{ ...title, fontSize: 15 }}>{l.myLoyalty}</strong>
        <span className="pv-pill" style={{ background: palette.background }}>
          <span
            className="pv-star"
            style={{ background: palette.loyalty, color: palette.onLoyalty }}
          >
            ★
          </span>
          <b>{DEMO_POINTS}</b>&nbsp;pts
        </span>
      </div>
      {next ? (
        <div className="pv-next">
          {image ? <img src={image} alt="" /> : null}
          <span style={{ fontSize: 11 }}>
            <b style={{ color: palette.loyalty }}>{next.costPoints} pts</b>
            <br />
            {l.unlockPrefix(next.costPoints - DEMO_POINTS)} <b>{next.name}</b> !
          </span>
        </div>
      ) : (
        <span style={{ fontSize: 11 }}>{l.allUnlocked}</span>
      )}
      <div className="pv-track" style={{ background: palette.border }}>
        <div style={{ width: `${Math.round(progress * 100)}%`, background: palette.loyalty }} />
      </div>
      <span style={{ color: palette.accent, fontWeight: 700, fontSize: 11 }}>
        {l.keepShopping} ›
      </span>
    </div>
  );
}

function Home(ctx: Ctx) {
  const { palette, radii, title } = ctx;
  return (
    <>
      <Header {...ctx} />
      <div className="pv-body">
        <span style={{ color: palette.textMuted, fontSize: 12 }}>{l.hello('Camille')}</span>
        <strong style={{ ...title, fontSize: 22 }}>{l.hungry}</strong>
        <div
          className="pv-card"
          style={{
            background: palette.primary,
            color: palette.onPrimary,
            borderRadius: radii.card + 6,
          }}
        >
          <strong style={{ ...title, fontSize: 16 }}>{l.orderOnline}</strong>
          <span style={{ fontSize: 11, opacity: 0.85 }}>{l.orderHint}</span>
          <div className="pv-row">
            <span
              className="pv-btn"
              style={{
                background: palette.onPrimary,
                color: palette.primary,
                borderRadius: radii.button,
              }}
            >
              {l.pickup}
            </span>
            <span
              className="pv-btn"
              style={{ border: `2px solid ${palette.onPrimary}`, borderRadius: radii.button }}
            >
              {l.delivery}
            </span>
          </div>
        </div>
        <LoyaltyCard {...ctx} />
      </div>
    </>
  );
}

function ProductCard({ p, ctx }: { p: PreviewProduct; ctx: Ctx }) {
  const { palette, radii } = ctx;
  return (
    <div
      className="pv-product"
      style={{
        background: palette.background,
        borderRadius: radii.card,
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className="pv-img">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : null}</div>
      <b style={{ ...ctx.title, fontSize: 11 }}>{p.name}</b>
      <span className="pv-desc" style={{ color: palette.textMuted }}>
        {p.description}
      </span>
      <b style={{ color: palette.accent, fontSize: 11 }}>{price(p.priceCents)}</b>
    </div>
  );
}

function MenuScreen(ctx: Ctx) {
  const { palette, radii, title, data } = ctx;
  return (
    <>
      <Header {...ctx} compact>
        <span className="pv-back">‹ Retour</span>
      </Header>
      <div className="pv-body">
        <div className="pv-chips">
          {data.categories.slice(0, 4).map((c, i) => (
            <span
              key={c}
              style={{
                ...title,
                fontSize: 10,
                borderRadius: radii.chip,
                background: i === 0 ? palette.primary : palette.surface,
                color: i === 0 ? palette.onPrimary : palette.text,
                border: `1px solid ${i === 0 ? palette.primary : palette.border}`,
              }}
            >
              {c}
            </span>
          ))}
        </div>
        <strong style={{ ...title, fontSize: 15 }}>{data.categories[0] ?? ''}</strong>
        <div className="pv-grid">
          {data.products.slice(0, 6).map((p) => (
            <ProductCard key={p.id} p={p} ctx={ctx} />
          ))}
        </div>
      </div>
    </>
  );
}

function CardScreen(ctx: Ctx) {
  const { palette, radii, title, tenantName } = ctx;
  return (
    <div className="pv-body" style={{ paddingTop: 28, alignItems: 'center', textAlign: 'center' }}>
      <strong style={{ ...title, fontSize: 18 }}>{l.cardTitle}</strong>
      <div
        className="pv-vip"
        style={{
          background: palette.loyalty,
          color: palette.onLoyalty,
          borderRadius: radii.card + 8,
        }}
      >
        <strong style={{ ...title, fontSize: 14 }}>{tenantName}</strong>
        <span
          className="pv-badge"
          style={{ background: palette.onLoyalty, color: palette.loyalty }}
        >
          👑 {l.vip}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700 }}>Camille</span>
        <div className="pv-qr" aria-hidden />
        <span style={{ fontSize: 10, fontWeight: 700 }}>S360-APERCU0001</span>
        <strong style={{ ...title, fontSize: 22 }}>{DEMO_POINTS} PTS</strong>
      </div>
      <span style={{ color: palette.textMuted, fontSize: 11 }}>{l.cardHint}</span>
    </div>
  );
}

function Rewards(ctx: Ctx) {
  const { palette, radii, title, data } = ctx;
  return (
    <>
      <Header {...ctx} compact>
        <strong style={{ ...title, fontSize: 14 }}>{l.clubWord}</strong>
      </Header>
      <div className="pv-body">
        <LoyaltyCard {...ctx} />
        {data.tiers.map((tier) => {
          const unlocked = tier.costPoints <= DEMO_POINTS;
          return (
            <div key={tier.name + tier.costPoints} className="pv-tier">
              <span style={{ ...title, fontSize: 13 }}>
                <span
                  className="pv-star"
                  style={{ background: palette.loyalty, color: palette.onLoyalty }}
                >
                  ★
                </span>{' '}
                {l.tierTitle(tier.costPoints)}{' '}
                <small style={{ color: palette.textMuted, textTransform: 'none', fontWeight: 400 }}>
                  {tier.name}
                </small>
              </span>
              <div className="pv-hscroll">
                {tier.products.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    className="pv-gift"
                    style={{
                      borderRadius: radii.card,
                      border: `2px solid ${unlocked ? palette.loyalty : palette.border}`,
                      opacity: unlocked ? 1 : 0.55,
                    }}
                  >
                    <div className="pv-img">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" /> : null}
                    </div>
                    <b style={{ fontSize: 10 }}>{p.name}</b>
                    {unlocked ? (
                      <span
                        className="pv-btn small"
                        style={{
                          background: palette.loyalty,
                          color: palette.onLoyalty,
                          borderRadius: radii.button,
                        }}
                      >
                        {l.choose}
                      </span>
                    ) : (
                      <span style={{ fontSize: 9, color: palette.textMuted }}>
                        🔒 {l.missingPoints(tier.costPoints - DEMO_POINTS)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TabBar({ palette, tab, onTab }: Ctx & { tab: Tab; onTab: (t: Tab) => void }) {
  const items: { key: Tab | null; label: string; icon: string }[] = [
    { key: 'home', label: messages.tabs.home, icon: '⌂' },
    { key: 'rewards', label: messages.tabs.rewards, icon: '🎁' },
    { key: 'menu', label: messages.tabs.order, icon: '🍔' },
    { key: 'card', label: messages.tabs.card, icon: '▦' },
    { key: null, label: messages.tabs.account, icon: '◯' },
  ];
  return (
    <div
      className="pv-tabbar"
      style={{ background: palette.background, borderTop: `1px solid ${palette.border}` }}
    >
      {items.map((it, i) => {
        const center = i === 2;
        const active = it.key === tab;
        return (
          <button
            key={it.label}
            type="button"
            tabIndex={-1}
            onClick={() => it.key && onTab(it.key)}
            className={center ? 'pv-tabitem center' : 'pv-tabitem'}
            style={{ color: active || center ? palette.accent : palette.textMuted }}
          >
            {center ? (
              <span
                className="pv-center"
                style={{
                  background: palette.primary,
                  color: palette.onPrimary,
                  borderColor: palette.background,
                }}
              >
                {it.icon}
              </span>
            ) : (
              <span>{it.icon}</span>
            )}
            <span style={{ fontWeight: active || center ? 800 : 600 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
