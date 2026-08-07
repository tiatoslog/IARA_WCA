/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O motor cognitivo roda fora do Next (porta 8787). Nada de rewrites aqui:
  // o WebSocket é aberto direto pelo cliente via NEXT_PUBLIC_IARA_WS.
};

export default nextConfig;
