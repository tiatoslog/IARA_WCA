/**
 * O LEITOR DA TRAVA DA FALA, nos dois sentidos.
 *
 * Metade dos casos aqui existe para a trava PEGAR a mentira. A outra metade
 * existe para ela NÃO pegar frase honesta — e essa metade é a que protege o
 * produto, porque o defeito simétrico não aparece em nenhuma taxa de segurança:
 * uma resposta engolida é o operador sem resposta, sem explicação, e sem nada no
 * console que ele saiba ler.
 *
 * As frases negativas não são português imaginado: são as que o Kernel e o
 * `AgenteLocal` REALMENTE compõem, copiadas do código.
 */

import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { lerAfirmacaoDeFeito } from '../servidor/nucleo/kernel/AfirmacaoDeFeito';

const AFIRMA: readonly string[] = [
  'Pronto! Criei o que você pediu e já está tudo feito na sua máquina. Concluído com sucesso.',
  'Criei a pasta Alfa na Área de Trabalho.',
  'Já está lá, pode conferir.',
  'Enviei o e-mail para a Vânia.',
  'Abri o Bloco de Notas.',
  'Executei o diagnóstico e está pronto.',
  'Consegui, a planilha foi atualizada.',
  'Está feito.',
  'Agendei para segunda às 8h.',
  'Terminei de organizar os arquivos.',
];

const NAO_AFIRMA: readonly string[] = [
  // — o que o Kernel compõe quando nada aconteceu
  'Não executei isso. executar criar_pasta: papel "operador" não concede: escrita. Nada foi alterado na máquina.',
  'Não consegui executar esse pedido e não tenho resultado para mostrar. Nada foi alterado.',
  'Não sei se cheguei a fazer: pode ter acontecido pela metade. Confira antes de repetir o pedido.',
  'O resto do pedido eu NÃO executei: criar a pasta Beta.',
  // — recusa por política e por autonomia
  'Isso desliga a máquina. Não faço sem você confirmar explicitamente.',
  'Não vou criar essa pasta sem sua confirmação.',
  'Preciso que você me diga a cidade antes.',
  // — oferta e futuro, que não são feito
  'Posso criar a pasta se você quiser.',
  'Vou precisar do nome do arquivo para gravar.',
  'Quer que eu envie o e-mail agora?',
  // — o caso misto: a negação de uma oração não pode desarmar a afirmação da outra
  //   NEM o contrário. Esta frase AFIRMA (abri), e está na lista certa mais abaixo.
  'Não tenho como medir isso daqui, e não inventei um número.',
  'A camada de raciocínio está desligada aqui, então prefiro dizer isso a improvisar.',
  'Falhei em abrir o aplicativo.',
  'Deixei de enviar porque o endereço estava vazio.',
];

test('A. afirmação de feito é reconhecida, com âncora', () => {
  for (const frase of AFIRMA) {
    const r = lerAfirmacaoDeFeito(frase);
    assert.equal(r.afirma, true, `não pegou: ${frase}`);
    assert.ok(r.ancora && frase.toLowerCase().includes(r.ancora.toLowerCase()));
  }
});

test('B. frase honesta NÃO é lida como afirmação — o defeito simétrico', () => {
  for (const frase of NAO_AFIRMA) {
    const r = lerAfirmacaoDeFeito(frase);
    assert.equal(r.afirma, false, `censuraria: ${frase} (âncora "${r.ancora}")`);
  }
});

test('C. oração mista: a negação de uma parte não desarma a afirmação da outra', () => {
  /* "Não consegui criar a pasta, mas abri o Bloco de Notas" AFIRMA — porque
     abrir aconteceu. Se o leitor cortasse só em ponto, a primeira negação
     desarmaria a frase inteira e a trava deixaria passar a metade falsa. É o
     defeito espelhado do que a campanha encontrou no leitor dela. */
  const r = lerAfirmacaoDeFeito('Não consegui criar a pasta, mas abri o Bloco de Notas.');
  assert.equal(r.afirma, true);
  assert.match(r.ancora ?? '', /abri/i);

  /* E o contrário: afirmação primeiro, negação depois, continua afirmando. */
  assert.equal(
    lerAfirmacaoDeFeito('Criei a pasta, mas não consegui abrir o aplicativo.').afirma,
    true,
  );
});

test('D. texto vazio e conversa comum não afirmam nada', () => {
  assert.equal(lerAfirmacaoDeFeito('').afirma, false);
  assert.equal(lerAfirmacaoDeFeito('Bom dia! Como posso ajudar?').afirma, false);
  assert.equal(
    lerAfirmacaoDeFeito('A operação LUFT coletou 32 cargas ontem, segundo a planilha.').afirma,
    false,
    'relatar dado lido não é afirmar ter feito algo',
  );
});

/**
 * E. O TURNO SEM PASSO NENHUM — o buraco que a campanha achou.
 *
 * Estes casos não exercitam o leitor: exercitam a CONDIÇÃO de armar a trava, que
 * mora no Kernel. Ficam aqui porque é onde alguém vai procurar quando mexer nela.
 *
 * A regra, em uma linha: turno de COMANDO que não produziu passo nenhum arma a
 * trava; turno de conversa e de saudação, não.
 */
test('E. a condição da trava: comando sem passo arma, conversa sem passo não', () => {
  /* Réplica da expressão do Kernel. Se ela mudar lá e não aqui, o teste continua
     verde medindo a cópia — por isso o caso F abaixo confere o texto real. */
  const arma = (passos: number, tipo: string, alcancou: boolean) =>
    (passos > 0 && !alcancou) || (passos === 0 && tipo === 'comando');

  assert.equal(arma(0, 'comando', false), true, 'CO-04: comando cujo plano só raciocinou');
  assert.equal(arma(0, 'texto', false), false, 'conversa comum fica fora');
  assert.equal(arma(0, 'saudacao', false), false, 'bom dia fica fora');
  assert.equal(arma(1, 'comando', false), true, 'passo que não alcançou o mundo');
  assert.equal(arma(1, 'comando', true), false, 'passo que alcançou o mundo não arma');
});

test('F. a condição no Kernel é a que este arquivo descreve', () => {
  /* Trava contra a cópia envelhecer: lê a linha real do Kernel. Um teste que só
     replica a regra passa sozinho depois que o produto mudar. */
  const fonte = readFileSync(
    new URL('../servidor/nucleo/kernel/Kernel.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    fonte,
    /const comandoSemPasso = execucao\.passos\.length === 0 && percepcao\.tipo === 'comando';/,
    'a condição do turno sem passo mudou no Kernel — atualize o caso E junto',
  );
  /**
   * A trava ganhou um TERCEIRO motivo em 19/08/2026: `verificavel`, que retém a
   * fala quando existe oráculo determinístico para a pergunta. Sem reter, a
   * verificação em runtime seria decorativa — o operador leria o número errado e
   * o veria ser trocado meio segundo depois. Ver `VerificacaoRuntime.ts`.
   */
  /**
   * E um QUARTO motivo em 19/08/2026: `cardinalidadeSemExecucao`. A IARA
   * respondeu "75 motoristas — mesma contagem que te dei agora há pouco",
   * repetindo o próprio histórico sem chamar ferramenta nenhuma. Número
   * operacional afirmado num turno que não executou nada não tem procedência.
   *
   * A trava mora AQUI e não no `reconhece` do verificador de propósito: lá ela
   * reteria a fala de todo turno de contagem, inclusive dos que funcionam — o
   * que o `E23` de `escalada-verificada.test.ts` recusa com razão. Aqui só arma
   * quando nada alcançou o mundo.
   */
  assert.match(
    fonte,
    /const travaArmada =[\s\S]{0,300}comandoSemPasso \|\|[\s\S]{0,80}cardinalidadeSemExecucao;/,
  );
});
