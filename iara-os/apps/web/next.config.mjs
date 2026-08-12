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
 * MAS: o problema acima é de MÁQUINA DE DESENVOLVIMENTO. Em nuvem não existem
 * duas instâncias na mesma cópia do repositório, e o build da Vercel procura
 * `.next` POR NOME. Se o ambiente de build tiver um `PORT` qualquer ≠ 3000, o
 * output vai para `.next-XXXX` e o deploy morre com
 *
 *     Error: No Output Directory named ".next" found after the Build completed.
 *
 * — uma mensagem que não menciona porta nenhuma e leva horas para ser ligada à
 * causa. Derivar o diretório de uma variável que o HOST controla troca um bug
 * local raro por um deploy que não sobe. Em nuvem, `.next` e ponto final.
 */
const emNuvem = Boolean(process.env.VERCEL || process.env.CI);
const porta = emNuvem ? '3000' : (process.env.PORT ?? process.env.IARA_PORTA ?? '3000');

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
