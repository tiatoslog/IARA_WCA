/**
 * ENTRAR COM O BRAÇO — o login deste computador, uma vez só.
 *
 *     npm run braco:entrar
 *
 * Pergunta e-mail e senha da MESMA conta que a operadora usa na IARA, troca
 * isso por uma sessão do Supabase e guarda apenas o refresh token no perfil do
 * usuário (ver `servidor/braco/credencial.ts`). A senha não é escrita em lugar
 * nenhum — nem em arquivo, nem em variável de ambiente, nem no histórico do
 * terminal, que é exatamente o que aconteceria se isto fosse um parâmetro de
 * linha de comando.
 *
 * ESTE SCRIPT É PROVISÓRIO E ISSO ESTÁ NO PLANO. Ele é a forma de teclado do
 * pareamento; a forma final é o QR — o app no computador mostra um código, o
 * celular já logado aprova, e o arquivo de credencial nasce sem ninguém digitar
 * senha nenhuma numa máquina. O que não muda é o formato do arquivo: quando o
 * QR entrar, este script pode sumir sem que o braço saiba.
 */

import { createInterface } from 'node:readline';
import { config as carregarEnv } from 'dotenv';
import { caminhoCredencial, salvarCredencial, wsDoMotor } from '../servidor/braco/credencial';

carregarEnv({ path: '.env.local' });
carregarEnv();

const leitor = createInterface({ input: process.stdin, output: process.stdout });

function perguntar(rotulo: string): Promise<string> {
  return new Promise((resolver) => leitor.question(rotulo, (r) => resolver(r.trim())));
}

/**
 * Senha sem eco. `readline` não tem isso pronto: o truque é interceptar a
 * escrita do terminal enquanto a pergunta está aberta. Sem ele a senha fica
 * legível na tela e, pior, no scrollback do terminal — que costuma sobreviver
 * bem mais que a sessão.
 */
function perguntarSenha(rotulo: string): Promise<string> {
  return new Promise((resolver) => {
    const saida = leitor as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (s: string) => void };
    const escreverOriginal = saida._writeToOutput;
    saida._writeToOutput = (texto: string) => {
      // Deixa passar só o rótulo; o que a pessoa digita vira nada.
      if (texto.includes(rotulo)) saida.output.write(texto);
    };
    leitor.question(rotulo, (r) => {
      saida._writeToOutput = escreverOriginal;
      saida.output.write('\n');
      resolver(r);
    });
  });
}

async function principal(): Promise<void> {
  console.log('\n  IARA — conectar este computador\n');

  /**
   * As chaves do projeto vêm do `.env.local` quando ele existe (máquina de
   * desenvolvimento) e da pergunta quando não existe (computador de operadora,
   * onde não há repositório). Perguntar sempre seria pedir que alguém copiasse
   * uma URL de 40 caracteres que a máquina já sabe.
   */
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    (await perguntar('  URL do Supabase: '));
  const chave =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? (await perguntar('  Chave anon do Supabase: '));

  if (!url || !chave) {
    console.error('\n  Sem URL e chave do projeto não há como entrar. Abortado.\n');
    process.exitCode = 1;
    return;
  }

  /**
   * O endereço da instalação. Vem do ambiente quando existe; senão pergunta com
   * um padrão, porque quem instala numa máquina de operadora não deveria
   * precisar saber o domínio de cor.
   */
  const padraoMotor = process.env.NEXT_PUBLIC_IARA_MOTOR ?? 'https://iara.up.railway.app';
  const motor = (await perguntar(`  Endereço da IARA [${padraoMotor}]: `)) || padraoMotor;
  try {
    wsDoMotor(motor);
  } catch {
    console.error(`\n  "${motor}" não é um endereço válido. Abortado.\n`);
    process.exitCode = 1;
    return;
  }

  const email = await perguntar('  E-mail: ');
  const senha = await perguntarSenha('  Senha: ');

  const resposta = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });

  if (!resposta.ok) {
    /**
     * O motivo exato não é repetido de propósito — "e-mail não existe" e "senha
     * errada" separados transformam esta tela num oráculo de contas válidas.
     * É a mesma disciplina de `verificarToken`, que devolve `null` sem dizer
     * qual dos dois foi.
     */
    console.error('\n  Não entrei: e-mail ou senha não conferem.\n');
    process.exitCode = 1;
    return;
  }

  const dados = (await resposta.json()) as { refresh_token?: string; user?: { email?: string } };
  if (!dados.refresh_token) {
    console.error('\n  O Supabase aceitou o login mas não devolveu sessão renovável. Abortado.\n');
    process.exitCode = 1;
    return;
  }

  salvarCredencial({
    motor,
    url_supabase: url,
    chave_anon: chave,
    refresh_token: dados.refresh_token,
    email: dados.user?.email ?? email,
    atualizado_em: new Date().toISOString(),
  });

  console.log(`\n  Pronto. Este computador está conectado como ${dados.user?.email ?? email}.`);
  console.log(`  Sessão guardada em ${caminhoCredencial()}`);
  console.log('  Agora é só deixar o braço rodando:  npm run braco\n');
}

void principal()
  .catch((erro: Error) => {
    console.error(`\n  Falhou: ${erro.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => leitor.close());
