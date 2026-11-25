import { messages } from '@splash360/i18n';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';
import type { TicketScannerProps } from './TicketScanner';

const t = messages.ambassador;

/**
 * Version installée : caméra Expo (QR uniquement). Nécessite un build EAS incluant expo-camera ;
 * la caméra est démontée dès la lecture ou la fermeture.
 */
export function TicketScanner({ onRead, onClose }: TicketScannerProps) {
  const { palette, radii } = useTenant();
  const [permission, request] = useCameraPermissions();
  const done = useRef(false);

  if (!permission) return null;
  if (!permission.granted)
    return (
      <View style={styles.box}>
        <Text style={{ color: palette.textMuted }}>{t.scanHint}</Text>
        {permission.canAskAgain ? (
          <PrimaryButton label={t.cameraPermission} onPress={() => void request()} />
        ) : (
          <Text style={{ color: palette.accent }} accessibilityRole="alert">
            {t.cameraUnavailable}
          </Text>
        )}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.link}>
          <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.scanTyped}</Text>
        </Pressable>
      </View>
    );

  return (
    <View style={styles.box}>
      <Text style={{ color: palette.textMuted }}>{t.scanHint}</Text>
      <View style={[styles.preview, { borderRadius: radii.card, borderColor: palette.primary }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (done.current || !data.trim()) return;
            done.current = true;
            onRead(data);
          }}
        />
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
