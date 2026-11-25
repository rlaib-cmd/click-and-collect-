import {
  TICKET_PHOTO_MAX_AGE_DAYS,
  ticketRefFromQr,
  ticketRefSchema,
  type AmbassadorEntryDto,
} from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  composeStory,
  copyText,
  photoForCheck,
  photoSupported,
  pickPhoto,
  shareStory,
  type Story,
} from '@/ambassador/media';
import { InstagramHandleField } from '@/ambassador/InstagramHandleField';
import { ApiRequestError } from '@/api/client';
import {
  useAmbassador,
  useAmbassadorEntry,
  useAmbassadorProfile,
  usePhotoCheck,
  useTicketPhoto,
} from '@/api/hooks';
import { titleStyle } from '@/components/brand';
import { TicketScanner } from '@/ambassador/TicketScanner';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { BackButton, Loading, PrimaryButton, Screen } from '@/components/ui';
import {
  displayHandle,
  handleForCopy,
  photoFeedback,
  progressIndex,
  stageLabel,
  ticketCheckLabel,
  ticketReadSummary,
  type AmbassadorStep,
} from '@/lib/ambassador';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.ambassador;

/** Résultat de l'analyse de la photo : verdict signé par le serveur, ou analyse impossible. */
type PhotoCheck =
  | { readonly verdict: 'accepted' | 'rejected' | 'doubtful'; readonly token: string }
  | { readonly verdict: 'error' };

/**
 * Ticket photographié (lot 20) : données lues par l'IA, signées par le serveur, à confirmer par
 * le client ; ou lecture impossible (il tape alors le numéro).
 */
type Receipt =
  | {
      readonly kind: 'read';
      readonly summary: string;
      readonly token: string;
      readonly confirmed: boolean;
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Ambassadeur (lots 15 et 17, ADR 0019 et 0022) : ticket → photo du produit (analysée, jamais
 * conservée) avec le cadre de l'enseigne → story Instagram taguée. Une participation par achat,
 * enregistrée « en attente » : les points sont crédités après la mention et le délai de
 * vérification de l'enseigne. Le compte Instagram du client est mémorisé.
 */
export default function AmbassadorScreen() {
  const { config, palette, style, radii } = useTenant();
  const { member, memberToken } = useLoyalty();
  const insets = useSafeAreaInsets();
  const program = useAmbassador();
  const profile = useAmbassadorProfile(memberToken);
  const entry = useAmbassadorEntry(memberToken);
  const check = usePhotoCheck(memberToken);
  const ticketPhoto = useTicketPhoto(memberToken);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [step, setStep] = useState<AmbassadorStep>('intro');
  const [ticket, setTicket] = useState('');
  // Contenu brut du QR scanné (envoyé au serveur seulement, qui en déduit lui-même le ticket).
  const [ticketQr, setTicketQr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onScanned = useCallback((raw: string) => {
    setScanning(false);
    setReceipt(null);
    setTicketQr(raw.trim());
    setTicket(ticketRefFromQr(raw));
    setError(null);
  }, []);
  const closeScanner = useCallback(() => setScanning(false), []);
  const [story, setStory] = useState<Story | null>(null);
  const [photo, setPhoto] = useState<PhotoCheck | null>(null);
  const [created, setCreated] = useState<AmbassadorEntryDto | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const brand = config.tenant.name;

  if (!program.data) return <Loading />;
  if (!program.data.enabled) return <Redirect href="/" />;
  const { instagramHandle, bonusPoints } = program.data;
  const savedHandle = profile.data?.instagramHandle ?? null;

  const progress = progressIndex(step);
  const input = [styles.input, { borderColor: palette.border, color: palette.text }];
  const feedback = photo ? photoFeedback(photo.verdict, brand) : null;

  const receiptToken = receipt?.kind === 'read' && receipt.confirmed ? receipt.token : null;

  /** « Achat vérifié » : le ticket est lu par le serveur (copie réduite, jamais conservée). */
  const takeTicketPhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    setError(null);
    setTicketQr(null);
    setReceipt(null);
    const sample = await photoForCheck(file).catch(() => null);
    if (!sample) return setReceipt({ kind: 'failed', message: t.ticketPhotoError });
    ticketPhoto.mutate(sample, {
      onSuccess: (r) => {
        const summary = ticketReadSummary(r);
        setReceipt(
          summary && r.token
            ? { kind: 'read', summary, token: r.token, confirmed: false }
            : { kind: 'failed', message: t.ticketUnreadable },
        );
      },
      onError: (e) =>
        setReceipt({
          kind: 'failed',
          message:
            e instanceof ApiRequestError && e.code === 'invalid_request'
              ? t.ticketDateRejected(TICKET_PHOTO_MAX_AGE_DAYS)
              : t.ticketPhotoError,
        }),
    });
  };

  const nextFromTicket = () => {
    if (receiptToken) {
      setError(null);
      return setStep(photoSupported ? 'photo' : 'story');
    }
    const parsed = ticketRefSchema.safeParse(ticket);
    if (!parsed.success) return setError(t.invalidTicket);
    setError(null);
    setStep(photoSupported ? 'photo' : 'story');
  };

  const choosePhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    setPhoto(null);
    setStory(
      await composeStory(file, {
        brand,
        primary: palette.primary,
        onPrimary: palette.onPrimary,
        background: palette.background,
        handle: displayHandle(instagramHandle),
      }),
    );
    // Analyse : une copie réduite part au serveur, qui ne la garde pas.
    const sample = await photoForCheck(file).catch(() => null);
    if (!sample) return setPhoto({ verdict: 'error' });
    check.mutate(sample, {
      onSuccess: (r) => setPhoto({ verdict: r.verdict, token: r.token }),
      onError: () => setPhoto({ verdict: 'error' }),
    });
  };

  /** Enregistre la participation (une seule fois pour ce parcours). */
  const register = (handle: string, then?: () => void) => {
    if (created) return then?.();
    entry.mutate(
      {
        ...(receiptToken
          ? { ticketPhoto: receiptToken }
          : { ticketRef: ticket, ...(ticketQr ? { ticketQr } : {}) }),
        instagramHandle: handle,
        ...(photo && photo.verdict !== 'error' ? { photoCheck: photo.token } : {}),
      },
      {
        onSuccess: (e) => {
          setCreated(e);
          then?.();
        },
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.code === 'conflict'
              ? t.ticketUsed
              : e instanceof ApiRequestError && e.code === 'invalid_request' && receiptToken
                ? t.ticketPhotoExpired
                : t.error,
          ),
      },
    );
  };

  /** Bouton principal : copie le compte (sans « @ »), ouvre le partage, enregistre la participation. */
  const share = () => {
    if (!savedHandle) return setError(t.instagramMissing);
    setError(null);
    void copyText(handleForCopy(instagramHandle)).then((ok) => {
      if (ok) setToast(t.nameCopied);
    });
    void shareStory(story, `${config.tenant.subdomain}-story.jpg`, displayHandle(instagramHandle))
      .then((r) => {
        if (r === 'downloaded') setToast(t.imageSaved);
      })
      .catch(() => undefined);
    register(savedHandle);
  };

  const published = () => {
    if (!savedHandle) return setError(t.instagramMissing);
    setError(null);
    register(savedHandle, () => setStep('sent'));
  };

  const ticketBadge = created ? (
    <View style={[styles.badge, { borderColor: palette.primary }]}>
      <Text style={{ color: palette.text, fontWeight: '800' }}>
        ✓ {t.ticketRegistered(created.ticketRef)}
      </Text>
    </View>
  ) : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: TAB_BAR_CLEARANCE + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton />
        {progress >= 0 ? (
          <View style={styles.progress} accessibilityRole="progressbar">
            {([t.progress.ticket, t.progress.photo, t.progress.story] as const).map((label, i) => (
              <View key={label} style={styles.progressItem}>
                <View
                  style={[
                    styles.progressBar,
                    { backgroundColor: i <= progress ? palette.primary : palette.border },
                  ]}
                />
                <Text
                  style={{
                    color: i === progress ? palette.accent : palette.textMuted,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {step === 'intro' ? (
          <>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>{t.title}</Text>
            {[
              [t.steps.ticket, t.steps.ticketHint],
              [t.steps.photo, t.steps.photoHint(brand)],
              [t.steps.tag(brand), t.steps.tagHint],
              [t.steps.bonus(bonusPoints), t.steps.bonusHint],
            ].map(([title, hint], i) => (
              <View key={title} style={[styles.howRow, { borderColor: palette.border }]}>
                <View style={[styles.howNumber, { backgroundColor: palette.surface }]}>
                  <Text style={{ color: palette.accent, fontWeight: '800' }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.howTitle, { color: palette.text }]}>{title}</Text>
                  {i === 2 ? (
                    <Text style={[styles.handle, { color: palette.accent }]}>
                      {displayHandle(instagramHandle)}
                    </Text>
                  ) : null}
                  <Text style={{ color: palette.textMuted }}>{hint}</Text>
                </View>
              </View>
            ))}
            {member ? (
              <PrimaryButton label={t.start} onPress={() => setStep('ticket')} />
            ) : (
              <>
                <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
                  {t.membersOnly}
                </Text>
                <PrimaryButton label={t.join} onPress={() => router.navigate('/carte')} />
              </>
            )}
          </>
        ) : null}

        {step === 'ticket' ? (
          <>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>
              {t.steps.ticket}
            </Text>
            <Text style={{ color: palette.textMuted }}>{t.steps.ticketHint}</Text>
            {scanning ? (
              <TicketScanner onRead={onScanned} onClose={closeScanner} />
            ) : ticketPhoto.isPending ? (
              <Text accessibilityLiveRegion="polite" style={{ color: palette.textMuted }}>
                {t.readingTicket}
              </Text>
            ) : receipt?.kind === 'read' ? (
              <View style={[styles.scanned, { borderColor: palette.primary }]}>
                <Text style={{ color: palette.text, fontWeight: '800' }} accessibilityRole="text">
                  {receipt.confirmed ? '✓ ' : ''}
                  {t.ticketReadTitle}
                </Text>
                <Text style={{ color: palette.text }}>{receipt.summary}</Text>
                {!receipt.confirmed ? (
                  <PrimaryButton
                    label={t.ticketReadConfirm}
                    onPress={() => setReceipt({ ...receipt, confirmed: true })}
                  />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void takeTicketPhoto()}
                  style={styles.link}
                >
                  <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.ticketRetake}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReceipt(null)}
                  style={styles.link}
                >
                  <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.scanTyped}</Text>
                </Pressable>
              </View>
            ) : ticketQr ? (
              <View style={[styles.scanned, { borderColor: palette.primary }]}>
                <Text style={{ color: palette.text, fontWeight: '800' }} accessibilityRole="text">
                  ✓ {t.scanned(ticket)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setScanning(true)}
                  style={styles.link}
                >
                  <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.scanRetry}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setTicketQr(null);
                    setTicket('');
                  }}
                  style={styles.link}
                >
                  <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.scanTyped}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {photoSupported ? (
                  <>
                    <PrimaryButton label={t.photoTicket} onPress={() => void takeTicketPhoto()} />
                    <Text style={{ color: palette.textMuted, fontSize: 13 }}>
                      {t.photoTicketHint} {t.ticketConsent}
                    </Text>
                    {receipt?.kind === 'failed' ? (
                      <Text accessibilityLiveRegion="polite" style={{ color: palette.accent }}>
                        {receipt.message}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                <PrimaryButton label={t.scanTicket} onPress={() => setScanning(true)} />
                <Text style={{ color: palette.textMuted, textAlign: 'center' }}>{t.orType}</Text>
                <Text style={{ color: palette.text, fontWeight: '700' }}>{t.ticketLabel}</Text>
                <TextInput
                  value={ticket}
                  onChangeText={setTicket}
                  placeholder={t.ticketPlaceholder}
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="characters"
                  accessibilityLabel={t.ticketLabel}
                  style={input}
                />
              </>
            )}
            {error ? <Text style={{ color: palette.accent }}>{error}</Text> : null}
            {receipt?.kind === 'read' && !receipt.confirmed ? null : (
              <PrimaryButton label={t.next} onPress={nextFromTicket} />
            )}
          </>
        ) : null}

        {step === 'photo' ? (
          <>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>
              {t.steps.photo}
            </Text>
            <Text style={{ color: palette.textMuted }}>{t.steps.photoHint(brand)}</Text>
            {story ? (
              <Image
                source={{ uri: story.url }}
                style={[styles.preview, { borderRadius: radii.card }]}
                contentFit="contain"
                accessibilityLabel={t.previewTitle}
              />
            ) : null}
            {check.isPending ? (
              <Text style={{ color: palette.textMuted }}>{t.analyzing}</Text>
            ) : feedback ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: feedback.blocking ? palette.accent : palette.text,
                  fontWeight: '700',
                }}
              >
                {feedback.text}
              </Text>
            ) : null}
            <Text style={{ color: palette.textMuted, fontSize: 13 }}>{t.consent(brand)}</Text>
            <PrimaryButton
              label={story ? t.retakePhoto : t.takePhoto}
              disabled={check.isPending}
              onPress={() => void choosePhoto()}
            />
            {story && photo && !feedback?.blocking ? (
              <PrimaryButton label={t.next} onPress={() => setStep('story')} />
            ) : null}
          </>
        ) : null}

        {step === 'story' ? (
          <>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>
              {t.previewTitle}
            </Text>
            {ticketBadge}
            <View
              style={[
                styles.account,
                { backgroundColor: palette.surface, borderColor: palette.primary },
              ]}
            >
              <Text style={{ color: palette.text, fontWeight: '700' }}>{t.accountTitle}</Text>
              <Text selectable style={[styles.handle, { color: palette.accent }]}>
                {displayHandle(instagramHandle)}
              </Text>
              <Text style={{ color: palette.textMuted }}>{t.steps.tagHint}</Text>
            </View>
            <InstagramHandleField memberToken={memberToken} />
            {story ? (
              <>
                <Image
                  source={{ uri: story.url }}
                  style={[styles.preview, { borderRadius: radii.card }]}
                  contentFit="contain"
                  accessibilityLabel={t.previewTitle}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setStep('photo')}
                  style={styles.link}
                >
                  <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.editPhoto}</Text>
                </Pressable>
              </>
            ) : (
              <Text style={{ color: palette.textMuted }}>{t.photoNative}</Text>
            )}
            {toast ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.toast, { backgroundColor: palette.text }]}
              >
                <Text style={{ color: palette.background, fontWeight: '700' }}>{toast}</Text>
              </View>
            ) : null}
            {error ? <Text style={{ color: palette.accent }}>{error}</Text> : null}
            <PrimaryButton label={t.shareInstagram} onPress={share} />
            <PrimaryButton
              label={entry.isPending ? t.sending : t.shared}
              disabled={entry.isPending}
              onPress={published}
            />
          </>
        ) : null}

        {step === 'sent' ? (
          <View style={styles.sent}>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>
              {t.sentTitle}
            </Text>
            {ticketBadge}
            {created ? (
              <Text style={{ color: palette.text, fontWeight: '700', textAlign: 'center' }}>
                {stageLabel(created, brand)}
              </Text>
            ) : null}
            {created && ticketCheckLabel(created) ? (
              <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
                {ticketCheckLabel(created)}
              </Text>
            ) : null}
            <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
              {t.sentHint(bonusPoints)}
            </Text>
            <PrimaryButton label={t.back} onPress={() => router.replace('/')} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 14 },
  h1: { fontSize: 28, fontWeight: '900' },
  progress: { flexDirection: 'row', gap: 6 },
  progressItem: { flex: 1, gap: 4 },
  progressBar: { height: 4, borderRadius: 2 },
  howRow: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  howNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howTitle: { fontSize: 17, fontWeight: '800' },
  handle: { fontSize: 26, fontWeight: '900' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  scanned: { borderWidth: 2, borderRadius: 12, padding: 14, gap: 4 },
  badge: { borderWidth: 2, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  link: { minHeight: 44, justifyContent: 'center' },
  preview: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#00000010' },
  account: { padding: 16, gap: 6, borderLeftWidth: 4, borderRadius: 12 },
  toast: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  sent: { alignItems: 'center', gap: 16, paddingTop: 40 },
});
