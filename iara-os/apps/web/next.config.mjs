/**
 * Um diretório de build POR PORTA.
 *
 * `.next` é estado mutável de um processo só. Duas instâncias do app na mesma
 * cópia do repositório — duas sessões de trabalho, ou um `next build` rodando
 * ao lado do `npm run dev` — apagam e reescrevem os mesmos arquivos, e a que
 * perde a corrida morre com erro que não tem nada a ver com o código:
 *
 *     ENOENT: ... .next\routes-manifest.json
 *     Cannot find module './chunks/vendor-chunks/next.js'
 *
 * A porta já identifica a instância (ver `PORTA` em servidor/principal.ts, e
 * o `autoPort` do .claude/launch.json). Derivar o diretório dela faz as duas
 * conviverem sem combinar nada. A porta padrão mantém `.next` puro, para não
 * quebrar cache, script nem instrução existente.
 */
const porta = process.env.PORT ?? process.env.IARA_PORTA ?? '3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: porta === '3000' ? '.next' : `.next-${porta}`,
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
