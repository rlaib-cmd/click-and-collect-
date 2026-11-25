/**
 * Version web : photo choisie sur l'appareil, cadre de l'enseigne dessiné sur un canvas,
 * partage par la feuille de partage du navigateur (Web Share API) ou téléchargement.
 * La photo ne quitte jamais l'appareil : rien n'est envoyé au serveur.
 */
export const photoSupported = true;

export interface StoryFrame {
  readonly brand: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly background: string;
}

export interface Story {
  readonly url: string;
  readonly blob: Blob;
}

export function pickPhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

/** Story 1080 × 1920 : bandeau de marque en haut, photo recadrée, damier en bas. */
export async function composeStory(file: File, frame: StoryFrame): Promise<Story | null> {
  const img = await loadImage(file);
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = frame.background;
  ctx.fillRect(0, 0, W, H);

  const top = 240;
  ctx.fillStyle = frame.primary;
  ctx.fillRect(0, 0, W, top);
  ctx.fillStyle = frame.onPrimary;
  ctx.font = '900 96px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(frame.brand.toUpperCase(), W / 2, top / 2, W - 120);

  // Photo recadrée pour remplir la zone, sans déformation.
  const pad = 60;
  const box = { x: pad, y: top + pad, w: W - pad * 2, h: H - top - pad * 2 - 120 };
  const scale = Math.max(box.w / img.width, box.h / img.height);
  const sw = box.w / scale;
  const sh = box.h / scale;
  ctx.drawImage(
    img,
    (img.width - sw) / 2,
    (img.height - sh) / 2,
    sw,
    sh,
    box.x,
    box.y,
    box.w,
    box.h,
  );

  // Damier de marque en bas.
  const cell = 40;
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < W / cell; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? frame.primary : frame.background;
      ctx.fillRect(col * cell, H - 120 + row * cell, cell, cell);
    }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
  );
  return blob ? { url: URL.createObjectURL(blob), blob } : null;
}

/** Feuille de partage du navigateur (avec l'image) ; sinon, l'image est téléchargée. */
export async function shareStory(
  story: Story | null,
  filename: string,
  _text = '',
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (!story) return 'cancelled';
  const file = new File([story.blob], filename, { type: 'image/jpeg' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = story.url;
  a.download = filename;
  a.click();
  return 'downloaded';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
