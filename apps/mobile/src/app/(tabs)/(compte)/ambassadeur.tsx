import { instagramHandleSchema, ticketRefSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  composeStory,
  copyText,
  photoSupported,
  pickPhoto,
  shareStory,
  type Story,
} from '@/ambassador/media';
import { ApiRequestError } from '@/api/client';
import { useAmbassador, useAmbassadorEntry } from '@/api/hooks';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { BackButton, Loading, PrimaryButton, Screen } from '@/components/ui';
import { displayHandle, handleForCopy, progressIndex, type AmbassadorStep } from '@/lib/ambassador';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.ambassador;

/**
 * Ambassadeur (lot 15, ADR 0019) : ticket → photo du burger avec le cadre de l'enseigne → story
 * Instagram taguée. La participation part « en attente » : le bonus n'est crédité qu'une fois la
 * mention vérifiée (vérification automatique à venir), une seule fois par ticket.
 */
export default function AmbassadorScreen() {
  const { config, palette, style, radii } = useTenant();
  const { member, memberToken } = useLoyalty();
  const insets = useSafeAreaInsets();
  const program = useAmbassador();
  const entry = useAmbassadorEntry(memberToken);
  const [step, setStep] = useState<AmbassadorStep>('intro');
  const [ticket, setTicket] = useState('');
  const [handle, setHandle] = useState('');
  const [story, setStory] = useState<Story | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brand = config.tenant.name;

  if (!program.data) return <Loading />;
  if (!program.data.enabled) return <Redirect href="/" />;
  const { instagramHandle, bonusPoints } = program.data;

  const progress = progressIndex(step);
  const input = [styles.input, { borderColor: palette.border, color: palette.text }];

  const nextFromTicket = () => {
    const parsed = ticketRefSchema.safeParse(ticket);
    if (!parsed.success) return setError(t.invalidTicket);
    setError(null);
    setStep(photoSupported ? 'photo' : 'story');
  };

  const choosePhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    setStory(
      await composeStory(file, {
        brand,
        primary: palette.primary,
        onPrimary: palette.onPrimary,
        background: palette.background,
      }),
    );
  };

  const copy = async () => {
    setCopied(await copyText(handleForCopy(instagramHandle)));
  };

  const send = () => {
    const parsedHandle = instagramHandleSchema.safeParse(handle);
    if (!parsedHandle.success) return setError(t.invalidHandle);
    setError(null);
    entry.mutate(
      { ticketRef: ticket, instagramHandle: parsedHandle.data },
      {
        onSuccess: () => setStep('sent'),
        onError: (e) =>
          setError(e instanceof ApiRequestError && e.code === 'conflict' ? t.ticketUsed : t.error),
      },
    );
  };

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
            <Text style={{ color: palette.textMuted, fontSize: 13 }}>{t.ticketSoon}</Text>
            {error ? <Text style={{ color: palette.accent }}>{error}</Text> : null}
            <PrimaryButton label={t.next} onPress={nextFromTicket} />
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
            <PrimaryButton
              label={story ? t.changePhoto : t.takePhoto}
              onPress={() => void choosePhoto()}
            />
            {story ? <PrimaryButton label={t.next} onPress={() => setStep('story')} /> : null}
          </>
        ) : null}

        {step === 'story' ? (
          <>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>
              {t.previewTitle}
            </Text>
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
              {photoSupported ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void copy()}
                  style={[styles.copy, { borderColor: palette.border }]}
                >
                  <Text style={{ color: palette.accent, fontWeight: '800' }}>
                    {copied ? t.copied : t.copy}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {story ? (
              <Image
                source={{ uri: story.url }}
                style={[styles.preview, { borderRadius: radii.card }]}
                contentFit="contain"
                accessibilityLabel={t.previewTitle}
              />
            ) : (
              <Text style={{ color: palette.textMuted }}>{t.photoNative}</Text>
            )}
            <PrimaryButton
              label={t.share}
              onPress={() =>
                void shareStory(
                  story,
                  `${config.tenant.subdomain}-story.jpg`,
                  displayHandle(instagramHandle),
                )
              }
            />
            <Text style={{ color: palette.text, fontWeight: '700' }}>{t.yourInstagram}</Text>
            <TextInput
              value={handle}
              onChangeText={setHandle}
              placeholder="@moncompte"
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t.yourInstagram}
              style={input}
            />
            <Text style={{ color: palette.textMuted, fontSize: 13 }}>{t.yourInstagramHint}</Text>
            {error ? <Text style={{ color: palette.accent }}>{error}</Text> : null}
            <PrimaryButton
              label={entry.isPending ? t.sending : t.shared}
              disabled={entry.isPending}
              onPress={send}
            />
          </>
        ) : null}

        {step === 'sent' ? (
          <View style={styles.sent}>
            <Text style={[styles.h1, titleStyle(style), { color: palette.text }]}>
              {t.sentTitle}
            </Text>
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
  preview: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#00000010' },
  account: { padding: 16, gap: 6, borderLeftWidth: 4, borderRadius: 12 },
  copy: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  sent: { alignItems: 'center', gap: 16, paddingTop: 40 },
});
