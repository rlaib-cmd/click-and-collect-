import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { messages } from '@splash360/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: messages.admin.title,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
