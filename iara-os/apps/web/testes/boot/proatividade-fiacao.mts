/**
 * PROATIVIDADE — A FIAÇÃO, MEDIDA NO MOTOR DE VERDADE.
 *
 * As baterias `proatividade*.test.ts` provam a política com o motor montado à
 * mão, em memória. Elas NÃO provam a única coisa que só o processo real prova:
 *
 *     que `Porta.ts` de fato monta o `MotorProativo`, de fato assina o
 *     barramento, e que o livro de verdade aparece em disco quando alguém fala
 *     com a IARA.
 *
 * É a distinção entre "a peça funciona" e "a peça está ligada". Uma suíte que
 * constrói o motor por conta própria passaria intacta com a fiação removida de
 * `Porta.ts` — que é o falso verde clássico desta casa.
 *
 * DESPEJA, NÃO JULGA — mas devolve código de saída, porque aqui existe uma
 * pergunta binária: o arquivo apareceu com o conteúdo certo, ou não.
 *
 *   node --import tsx testes/boot/proatividade-fiacao.mts
 *
 * NÃO ENTRA EM `npm test`: sobe um processo Node inteiro e leva dezenas de
 * segundos. A suíte roda a cada commit; isto roda quando a fiação muda.
 */

import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { ClienteBarramento } from '../campanha/ClienteBarramento';
import { limparMotoresEsquecidos, RAIZ_WEB, subirMotor } from '../campanha/MotorSandbox';

const PORTA = Number(process.argv.includes('--porta')
  ? process.argv[process.argv.indexOf('--porta') + 1]
  : 3079);

/**
 * Um id canônico só desta sonda. Não é um operador real, e o arquivo dele é
 * apagado no fim — o livro é dado privado, e uma sonda não pode deixar lixo com
 * cara de gente.
 */
const OPERADOR = 'sonda-fiacao-proativa';
const LIVRO = path.join(RAIZ_WEB, 'dados', 'proativo', `${OPERADOR}.json`);

function despejar(rotulo: string, valor: unknown): void {
  console.log(`\n── ${rotulo} ──`);
  console.log(typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2));
}

async function esperarArquivo(caminho: string, prazoMs: number): Promise<string | null> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    try {
      return readFileSync(caminho, 'utf8');
    } catch {
      await new Promise((pronto) => setTimeout(pronto, 250));
    }
  }
  return null;
}

async function principal(): Promise<number> {
  /* Estado de corrida anterior não pode virar o "verde" desta. */
  rmSync(LIVRO, { force: true });
  await limparMotoresEsquecidos([PORTA]);

  const motor = await subirMotor({ porta: PORTA, rotulo: 'fiacao-proativa' });
  console.log(`motor vivo em ${motor.url_ws} (pid ${motor.pid})`);

  const cliente = new ClienteBarramento({ url: motor.url_ws, id_usuario: OPERADOR, nome: 'Sonda' });

  let saida = 1;
  try {
    await cliente.conectar();
    console.log(`socket aberto em ${cliente.tentativas} tentativa(s)`);

    /**
     * UMA mensagem. Não interessa o que a IARA responde — pode nem haver
     * provedor. O que se mede é o EFEITO COLATERAL da assinatura de
     * `MENSAGEM_RECEBIDA`: o histograma de atividade desta pessoa.
     *
     * `enviar` cru, e não `dizer`: esperar o turno inteiro amarraria esta sonda
     * à disponibilidade de um modelo, que é justamente o que ela não está
     * medindo.
     */
    cliente.enviar({
      tipo: 'mensagem',
      texto: 'bom dia, iara',
      id_local: 'sonda-1',
      instante: Date.now(),
    });

    const bruto = await esperarArquivo(LIVRO, 45_000);
    if (!bruto) {
      despejar('VEREDICTO', 'NÃO APARECEU — o livro proativo não foi criado pelo motor real');
      despejar('stdout do motor', motor.saida.slice(-40).join('\n'));
      return 1;
    }

    const livro = JSON.parse(bruto) as {
      id_usuario: string;
      atividade: number[];
      contadores: Record<string, number>;
    };

    despejar('livro em disco', livro);

    const horas = livro.atividade.reduce((s, n) => s + n, 0);
    const ok = livro.id_usuario === OPERADOR && horas >= 1;

    despejar('VEREDICTO', {
      arquivo: LIVRO,
      dono_confere: livro.id_usuario === OPERADOR,
      mensagens_registradas: horas,
      resultado: ok ? 'FIAÇÃO VIVA' : 'FIAÇÃO MORTA',
    });

    /* As linhas do canal proativo que o motor real emitiu. É a observabilidade
       medida de fora do processo, e não pelo teste que a produziu. */
    const linhasProativas = motor.saida.filter((l) => l.includes('"canal":"proativo"'));
    despejar('log do canal proativo (motor real)', linhasProativas.slice(0, 10).join('\n') || '(nenhuma)');

    saida = ok ? 0 : 1;
  } catch (erro) {
    despejar('ERRO DA SONDA', (erro as Error).message);
    despejar('stdout do motor', motor.saida.slice(-40).join('\n'));
  } finally {
    await cliente.fechar().catch(() => undefined);
    await motor.encerrar().catch(() => undefined);
    rmSync(LIVRO, { force: true });
  }

  return saida;
}

process.exitCode = await principal();
