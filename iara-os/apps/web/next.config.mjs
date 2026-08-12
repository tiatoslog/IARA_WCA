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
 *
 * MAS ISSO É PROBLEMA DE MÁQUINA DE DESENVOLVIMENTO, e derivar o diretório de
 * uma variável que o HOST controla custou caro duas vezes:
 *
 * 1. No build: um `PORT` qualquer no ambiente manda o output para `.next-XXXX`
 *    e a Vercel morre com "No Output Directory named .next found" — mensagem
 *    que não menciona porta nenhuma.
 *
 * 2. Pior, e foi o que aconteceu no Railway: BUILD e RUNTIME resolvem a porta
 *    em momentos diferentes. O build roda sem `PORT` e escreve `.next`; o
 *    container sobe com `PORT=8080` injetado pelo host, o Next procura
 *    `.next-8080`, não acha, e o processo não sobe. O sintoma é healthcheck
 *    falhando com o build ali, íntegro, no diretório de sempre.
 *
 * A primeira tentativa de guarda olhava `VERCEL` e `CI` — e não pegava o caso 2,
 * porque num container em produção nenhuma das duas existe. O sinal correto não
 * é "estou num CI", é **"isto é um build de produção"**: só em desenvolvimento
 * existem duas instâncias disputando a mesma pasta.
 *
 * `NODE_ENV` é confiável nos três caminhos: `next build` roda como production,
 * `servidor/principal.ts` o define explicitamente antes de instanciar o Next
 * (linha 36), e `next dev` é development.
 */
const desenvolvimento = process.env.NODE_ENV !== 'production';
const porta = desenvolvimento
  ? (process.env.PORT ?? process.env.IARA_PORTA ?? '3000')
  : '3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: porta === '3000' ? '.next' : `.next-${porta}`,
  reactStrictMode: true,
  // Sem o selo de dev do Next no canto. Ele é um objeto de OUTRO produto dentro
  // da sala — e no app desktop a janela não é "um site em desenvolvimento", é o
  // escritório. Erro de compilação continua aparecendo no terminal do motor,
  // que é onde ele pertence.
  devIndicators: false,
  // Nada de rewrites aqui, nos dois modos: unificado, o motor É este processo e
  // o barramento é same-origin em /barramento; headless (Next na Vercel, motor
  // noutro host), o cliente abre o WebSocket direto no endereço que
  // `enderecoBarramento()` monta a partir de NEXT_PUBLIC_IARA_WS. Um rewrite
  // não serviria de qualquer jeito: proxy de WebSocket não é coisa que a Vercel
  // faça, e o áudio da voz vive na MEMÓRIA do motor — ver `urlVoz()` em
  // lib/supabaseNavegador.ts.
};

export default nextConfig;
