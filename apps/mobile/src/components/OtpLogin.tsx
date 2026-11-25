import { formatFrenchPhone, normalizeOtpIdentifier, type OtpChannel } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ApiRequestError } from '@/api/client';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';
import { titleStyle } from './brand';
import { PrimaryButton } from './ui';

const t = messages.otp;
const tl = messages.loyalty;

/** « Continuer avec Google » : emplacement prêt, affiché quand le projet Google sera créé. */
const GOOGLE_LOGIN = process.env.EXPO_PUBLIC_GOOGLE_LOGIN === '1';

type Step =
  | { readonly kind: 'identifier' }
  | {
      readonly kind: 'code';
      readonly identifier: string;
      readonly resendAt: number;
      readonly debugCode?: string | undefined;
    }
  | { readonly kind: 'name'; readonly identifier: string; readonly code: string };

function errorText(e: unknown): string {
  const code = e instanceof ApiRequestError ? e.code : null;
  switch (code) {
    case 'otp_invalid':
      return t.invalidCode;
    case 'otp_expired':
      return t.expiredCode;
    case 'rate_limited':
      return t.tooMany;
    default:
      return messages.tenant.networkError;
  }
}

/**
 * Connexion ou inscription au club par code (lot 10, ADR 0012) :
 * numéro de mobile (ou e-mail) → code reçu → prénom si le compte n'existe pas encore.
 */
export function OtpLogin({ onDemoLogin }: { onDemoLogin?: (() => void) | undefined }) {
  const { palette, radii, style } = useTenant();
  const { program, startCode, verifyCode } = useLoyalty();
  const [channel, setChannel] = useState<OtpChannel>('sms');
  const [raw, setRaw] = useState('');
  const [code, setCode] = useState('');
  const [terms, setTerms] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'identifier' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastTried = useRef('');

  // Compte à rebours du renvoi.
  useEffect(() => {
    if (step.kind !== 'code') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step.kind]);

  const welcome = program?.enabled ? program.welcomePoints : 0;
  const identifierOk = normalizeOtpIdentifier(channel, raw) !== null;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await startCode(channel, raw);
      setCode('');
      lastTried.current = '';
      setStep({
        kind: 'code',
        identifier: r.identifier,
        resendAt: Date.now() + r.resendInSeconds * 1000,
        debugCode: r.debugCode,
      });
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.code === 'invalid_request'
          ? channel === 'sms'
            ? t.invalidPhone
            : t.invalidEmail
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (step.kind !== 'code' || busy) return;
    lastTried.current = value;
    setBusy(true);
    setError(null);
    try {
      const r = await verifyCode({ channel, identifier: step.identifier, code: value });
      if (r === 'needsName') setStep({ kind: 'name', identifier: step.identifier, code: value });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (step.kind !== 'name') return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode({
        channel,
        identifier: step.identifier,
        code: step.code,
        acceptedTerms: true,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Les 6 chiffres saisis (ou collés par le clavier) : validation sans bouton.
  useEffect(() => {
    if (step.kind === 'code' && /^\d{6}$/.test(code) && code !== lastTried.current) {
      void verify(code);
    }
  }, [code, step.kind]);

  const input = [
    styles.input,
    {
      borderColor: palette.border,
      color: palette.text,
      backgroundColor: palette.surface,
      borderRadius: radii.card,
    },
  ];
  const link = { color: palette.accent, fontWeight: '600' as const };
  const shown = (id: string) => (channel === 'sms' ? formatFrenchPhone(id) : id);

  return (
    <View style={styles.form}>
      {step.kind === 'identifier' ? (
        <>
          <Text
            style={[styles.title, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {t.title}
          </Text>
          <Text style={[styles.center, { color: palette.textMuted, fontSize: 15 }]}>
            {t.intro(welcome)}
          </Text>
          <TextInput
            key={channel}
            accessibilityLabel={channel === 'sms' ? t.phone : t.email}
            placeholder={channel === 'sms' ? t.phonePlaceholder : t.email}
            placeholderTextColor={palette.textMuted}
            value={raw}
            onChangeText={setRaw}
            autoComplete={channel === 'sms' ? 'tel' : 'email'}
            textContentType={channel === 'sms' ? 'telephoneNumber' : 'emailAddress'}
            keyboardType={channel === 'sms' ? 'phone-pad' : 'email-address'}
            autoCapitalize="none"
            returnKeyType="send"
            onSubmitEditing={() => identifierOk && void send()}
            style={input}
          />
          <PrimaryButton
            label={t.sendCode}
            disabled={busy || !identifierOk}
            onPress={() => void send()}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setChannel(channel === 'sms' ? 'email' : 'sms');
              setRaw('');
              setError(null);
            }}
            style={styles.link}
          >
            <Text style={link}>{channel === 'sms' ? t.useEmail : t.usePhone}</Text>
          </Pressable>
          {GOOGLE_LOGIN ? (
            <>
              <Text style={[styles.center, { color: palette.textMuted }]}>{t.or}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                disabled
                style={[styles.google, { borderColor: palette.border, borderRadius: radii.button }]}
              >
                <Text style={{ color: palette.text, fontWeight: '700' }}>{t.google}</Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}

      {step.kind === 'code' ? (
        <>
          <Text
            style={[styles.title, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {t.codeTitle}
          </Text>
          <Text style={[styles.center, { color: palette.textMuted, fontSize: 15 }]}>
            {channel === 'sms'
              ? t.codeSentSms(shown(step.identifier))
              : t.codeSentEmail(step.identifier)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setStep({ kind: 'identifier' });
              setError(null);
            }}
            style={[styles.link, styles.centerSelf]}
          >
            <Text style={link}>{t.change}</Text>
          </Pressable>
          <TextInput
            accessibilityLabel={t.code}
            placeholder="••••••"
            placeholderTextColor={palette.textMuted}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            style={[input, styles.code]}
          />
          {step.debugCode ? (
            <Text style={[styles.center, { color: palette.textMuted, fontSize: 13 }]}>
              {t.debugCode(step.debugCode)}
            </Text>
          ) : null}
          <PrimaryButton
            label={t.verify}
            disabled={busy || !/^\d{6}$/.test(code)}
            onPress={() => void verify(code)}
          />
          {now < step.resendAt ? (
            <Text style={[styles.center, { color: palette.textMuted }]}>
              {t.resendIn(Math.ceil((step.resendAt - now) / 1000))}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => void send()}
              disabled={busy}
              style={[styles.link, styles.centerSelf]}
            >
              <Text style={link}>{t.resend}</Text>
            </Pressable>
          )}
        </>
      ) : null}

      {step.kind === 'name' ? (
        <>
          <Text
            style={[styles.title, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {t.nameTitle}
          </Text>
          <Text style={[styles.center, { color: palette.textMuted, fontSize: 15 }]}>
            {t.nameIntro}
          </Text>
          <View style={styles.toggle}>
            <Switch value={terms} onValueChange={setTerms} accessibilityLabel={tl.terms} />
            <Text style={{ color: palette.text, flex: 1 }}>{tl.terms}</Text>
          </View>
          <Pressable accessibilityRole="link" onPress={() => router.push('/legal')}>
            <Text style={{ color: palette.accent, textDecorationLine: 'underline' }}>
              {tl.legal}
            </Text>
          </Pressable>
          <PrimaryButton
            label={t.create(welcome)}
            disabled={busy || !terms}
            onPress={() => void create()}
          />
        </>
      ) : null}

      {error ? (
        <Text style={[styles.center, { color: palette.accent }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {onDemoLogin && step.kind === 'identifier' ? (
        <Pressable accessibilityRole="button" onPress={onDemoLogin} style={styles.link}>
          <Text style={{ color: palette.textMuted, fontSize: 13, textAlign: 'center' }}>
            {t.demoLogin}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, alignSelf: 'stretch' },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  center: { textAlign: 'center' },
  centerSelf: { alignSelf: 'center' },
  input: { borderWidth: 1, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '800' },
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  google: { minHeight: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
