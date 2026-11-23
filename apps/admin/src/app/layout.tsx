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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
