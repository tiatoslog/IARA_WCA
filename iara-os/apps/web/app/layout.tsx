import type { Metadata, Viewport } from 'next';
import { RegistrarPWA } from '../components/RegistrarPWA';
import './globals.css';

export const metadata: Metadata = {
  title: 'IARA OS',
  description: 'Escritório digital vivo da Atos Log',
  applicationName: 'IARA',
  appleWebApp: {
    capable: true,
    title: 'IARA',
    // A barra de status some e o app ocupa a tela inteira no iOS.
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icones/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // A cor da casca, não mais o creme antigo: é ela que pinta a barra do
  // sistema quando o app abre instalado.
  themeColor: '#06110e',
  width: 'device-width',
  initialScale: 1,
  // Sem zoom por gesto: o escritório é pixel art com enquadramento próprio, e
  // pinçar a tela só borraria o grid.
  maximumScale: 1,
  userScalable: false,
  // Ocupa a área sob o notch quando instalado.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <RegistrarPWA />
      </body>
    </html>
  );
}
