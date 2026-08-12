import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { RegistrarPWA } from '../components/RegistrarPWA';
import './globals.css';

/**
 * A tipografia deixa de depender do sistema operacional.
 *
 * A pilha antiga começava em `-apple-system` e caía em `Segoe UI` no Windows —
 * que é a máquina de TODA a equipe. Resultado: a IARA era desenhada num Mac e
 * lida numa fonte de sistema com outra métrica, outro peso e outro
 * espaçamento. Não é questão de gosto; é a tela mudando conforme quem olha.
 *
 * Inter variável, servida pelo PRÓPRIO domínio: o `next/font` baixa em tempo
 * de build e nunca faz requisição a terceiro em runtime — o que mantém a
 * página inteira funcionando instalada como PWA e sem rede.
 *
 * `display: 'swap'` é deliberado: texto legível na hora, com a fonte final
 * entrando em seguida. A alternativa esconde o texto por até 3 s, e uma tela
 * em branco esperando fonte é pior que uma troca de fonte visível.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--fonte-inter',
});

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
  // A cor da casca: é ela que pinta a barra do sistema quando o app abre
  // instalado. Grafite — anda junto com `--iara-bg` e com o manifest.
  themeColor: '#0b0d0f',
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
    <html lang="pt-BR" className={inter.variable}>
      <body>
        {children}
        <RegistrarPWA />
      </body>
    </html>
  );
}
