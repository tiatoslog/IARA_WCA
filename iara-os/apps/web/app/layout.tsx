import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IARA OS',
  description: 'Escritório digital vivo da Atos Log',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
