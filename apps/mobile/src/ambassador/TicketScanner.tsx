import { messages } from '@splash360/i18n';
import jsQR from 'jsqr';
import { createElement, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.ambassador;

export interface TicketScannerProps {
  /** Contenu brut du QR lu (la caméra est déjà arrêtée). */
  readonly onRead: (raw: string) => void;
  readonly onClose: () => void;
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (options: { formats: string[] }) => Detector;

/**
 * Version web : caméra arrière dans un aperçu, lecture du QR ~8 fois par seconde avec
 * `BarcodeDetector` quand le navigateur l'a, sinon `jsqr` sur un canvas. La caméra est coupée
 * dès la lecture, à la fermeture ou au démontage (aucune piste laissée ouverte).
 */
export function TicketScanner({ onRead, onClose }: TicketScannerProps) {
  const { palette, radii } = useTenant();
  const video = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let done = false;
    const stop = () => {
      done = true;
      clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
    };
    const canvas = document.createElement('canvas');
    const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;

    const read = async (el: HTMLVideoElement): Promise<string | null> => {
      if (el.readyState < 2 || el.videoWidth === 0) return null;
      if (detector) {
        const codes = await detector.detect(el).catch(() => []);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      }
      const w = Math.min(el.videoWidth, 960);
      const h = Math.round((el.videoHeight * w) / el.videoWidth);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(el, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      return jsQR(image.data, w, h)?.data ?? null;
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('caméra absente');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (done) return stop();
        const el = video.current;
        if (!el) return stop();
        el.srcObject = stream;
        await el.play().catch(() => undefined);
        let busy = false;
        timer = setInterval(() => {
          if (busy || done) return;
          busy = true;
          void read(el)
            .then((raw) => {
              if (raw && raw.trim() && !done) {
                stop();
                onRead(raw);
              }
            })
            .finally(() => (busy = false));
        }, 125);
      } catch {
        stop();
        setFailed(true);
      }
    })();
    return stop;
  }, [onRead]);

  if (failed)
    return (
      <View style={styles.box}>
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {t.cameraUnavailable}
        </Text>
        <PrimaryButton label={t.scanTyped} onPress={onClose} />
      </View>
    );

  return (
    <View style={styles.box}>
      <Text style={{ color: palette.textMuted }}>{t.scanHint}</Text>
      <View style={[styles.preview, { borderRadius: radii.card, borderColor: palette.primary }]}>
        {createElement('video', {
          ref: video,
          muted: true,
          playsInline: true,
          autoPlay: true,
          'aria-label': t.scanTicket,
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        })}
      </View>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.link}>
        <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.scanClose}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  preview: { width: '100%', aspectRatio: 1, overflow: 'hidden', borderWidth: 3 },
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
