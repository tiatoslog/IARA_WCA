/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sem o selo de dev do Next no canto. Ele é um objeto de OUTRO produto dentro
  // da sala — e no app desktop a janela não é "um site em desenvolvimento", é o
  // escritório. Erro de compilação continua aparecendo no terminal do motor,
  // que é onde ele pertence.
  devIndicators: false,
  // O motor cognitivo roda fora do Next (porta 8787). Nada de rewrites aqui:
  // o WebSocket é aberto direto pelo cliente via NEXT_PUBLIC_IARA_WS.
};

export default nextConfig;
