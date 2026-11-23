import { describe, expect, it } from 'vitest';
import { checkLogo, logoPath, MAX_LOGO_BYTES, sniffLogo } from './logo';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

describe('logo téléversé', () => {
  it('reconnaît PNG, JPEG et WebP par leurs premiers octets', () => {
    expect(sniffLogo(png)).toBe('png');
    expect(sniffLogo(jpeg)).toBe('jpeg');
    expect(sniffLogo(webp)).toBe('webp');
  });

  it('refuse le SVG et tout autre contenu', () => {
    expect(checkLogo(svg)).toEqual({ ok: false, error: 'logo_unsupported' });
    expect(checkLogo(new TextEncoder().encode('GIF89a'))).toEqual({
      ok: false,
      error: 'logo_unsupported',
    });
  });

  it('refuse un fichier vide ou de plus de 2 Mo', () => {
    expect(checkLogo(new Uint8Array())).toEqual({ ok: false, error: 'logo_empty' });
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(png);
    expect(checkLogo(big)).toEqual({ ok: false, error: 'logo_too_large' });
  });

  it('range le fichier dans le dossier de l’enseigne, nommé d’après son contenu', () => {
    const path = logoPath('tenant-a', png, 'png');
    expect(path).toMatch(/^tenant-a\/logo-[0-9a-f]{16}\.png$/);
    expect(logoPath('tenant-a', png, 'png')).toBe(path);
    expect(logoPath('tenant-a', jpeg, 'jpeg')).toMatch(/\.jpg$/);
  });
});
