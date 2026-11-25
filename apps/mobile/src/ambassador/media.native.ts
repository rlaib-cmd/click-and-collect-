import { Share } from 'react-native';
import type { Story, StoryFrame } from './media';

/**
 * Version installée (iOS, Android) : la photo avec cadre demande un module natif d'appareil photo
 * et de composition d'image, absent de la version actuelle de l'application (nouveau build EAS
 * nécessaire). En attendant : feuille de partage du système (Share de React Native, expo-sharing
 * n'étant pas installé) avec le texte, et le compte s'affiche sélectionnable pour être copié.
 */
export const photoSupported = false;
export type { Story, StoryFrame };

export const pickPhoto = (): Promise<null> => Promise.resolve(null);
export const composeStory = (): Promise<Story | null> => Promise.resolve(null);
export const photoForCheck = (): Promise<null> => Promise.resolve(null);

export async function shareStory(
  _story: Story | null,
  _filename: string,
  text = '',
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const result = await Share.share({ message: text });
  return result.action === Share.sharedAction ? 'shared' : 'cancelled';
}

/** Pas de presse-papiers natif (expo-clipboard non installé) : copie impossible ici. */
export const copyText = (_text: string): Promise<boolean> => Promise.resolve(false);
