import { SignJWT } from 'jose';
import { NextResponse } from 'next/server';

/**
 * Connexion de développement : signe un jeton au format Supabase pour un e-mail.
 * Uniquement avec ADMIN_DEV_LOGIN=1 hors production ; l'API vérifie ensuite le rôle en base.
 */
export async function POST(request: Request) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (process.env.NODE_ENV === 'production' || process.env.ADMIN_DEV_LOGIN !== '1' || !secret) {
    return NextResponse.json({ error: 'indisponible' }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: 'e-mail invalide' }, { status: 400 });
  const token = await new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`dev-${email}`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(new TextEncoder().encode(secret));
  return NextResponse.json({ token });
}
