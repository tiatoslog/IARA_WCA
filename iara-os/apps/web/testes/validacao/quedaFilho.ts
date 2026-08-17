/**
 * O PROCESSO QUE MORRE DE PROPÓSITO — metade da bateria `consistencia_queda`.
 *
 * `process.exit(1)` no meio de uma operação NÃO é simulável dentro do processo do
 * teste: um `throw` roda `finally`, um mock de crash grava o que um crash real não
 * gravaria, e as duas coisas testariam a simulação. Aqui o processo morre de
 * verdade, sem `finally`, sem flush, sem despedida — como um `kill -9`, um pico de
 * energia ou um OOM.
 *
 * Uso: `node --import tsx quedaFilho.ts <raiz> <momento>`
 *
 *   antes_do_efeito   grava `executando` e morre ANTES de tocar o mundo
 *   depois_do_efeito  grava `executando`, toca o mundo, morre ANTES de confirmar
 *   depois_de_verificar  ciclo completo até `verificada`, morre depois — o controle
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { RegistroOperacoes } from '../../servidor/nucleo/kernel/RegistroOperacoes';
import { evidencia } from '../../servidor/nucleo/kernel/Operacao';

const [raiz, momento] = process.argv.slice(2);
const OPERADOR = 'operador-de-queda';

/** O mundo é um arquivo: sobrevive à morte do processo, que é o ponto. */
const tocarOMundo = () =>
  appendFileSync(path.join(raiz, 'mundo.txt'), 'efeito aplicado\n', 'utf8');

const registro = new RegistroOperacoes(raiz);

const reserva = registro.reservar({
  habilidade: 'enviar_whatsapp',
  parametros: { telefone: '5565999999999', texto: 'mensagem da bateria de queda' },
  id_usuario: OPERADOR,
  sessao: 'queda',
  risco: 'medio',
  semantica: 'escrita_nao_idempotente',
  origem_pedido: 'lab-queda',
});
const id = reserva.operacao.id_operacao;

await registro.marcar(id, 'autorizada', evidencia('operador', 'autorizada pela bateria'));

/* `executando` é gravado ANTES do executor de propósito no produto — é o estado que
   a reidratação encontra quando o processo morre no meio, e "pode ter acontecido" é
   a única leitura honesta de um registro assim. A bateria existe para provar que
   essa promessa se cumpre num crash de verdade. */
await registro.marcar(id, 'executando', evidencia('executor', 'gravado antes de chamar o executor'));

if (momento === 'antes_do_efeito') {
  process.stdout.write(`${id}\n`);
  process.exit(1);
}

tocarOMundo();

if (momento === 'depois_do_efeito') {
  process.stdout.write(`${id}\n`);
  process.exit(1);
}

await registro.marcar(
  id,
  'executada_nao_verificada',
  evidencia('executor', 'o executor voltou sem erro'),
);
await registro.marcar(id, 'verificada', evidencia('verificador', 'o mundo mostra o efeito'));
process.stdout.write(`${id}\n`);
process.exit(0);
