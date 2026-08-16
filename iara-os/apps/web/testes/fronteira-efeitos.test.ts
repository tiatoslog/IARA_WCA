/**
 * FRONTEIRA DE EFEITOS — nenhum executor alcança o mundo por fora do portal.
 *
 * A auditoria anterior fechou a IDENTIDADE e a AUTORIZAÇÃO das escritas que
 * passavam pelo catálogo de habilidades. Ficou uma rota de fuga:
 *
 *     PortaWhatsapp.atender() → WhatsApp.responder() → POST graph.facebook.com
 *
 * Uma mensagem alcançava uma pessoa sem operação, sem chave de idempotência, sem
 * jornal e sem verificador. Consertar só o WhatsApp teria fechado UM caso e
 * deixado a classe aberta — a próxima integração nasceria com a mesma porta.
 *
 * Esta suíte tem duas metades, e a primeira é a que sobrevive ao tempo:
 *
 *  1. TESTE DE ARQUITETURA. Lê o código-fonte e falha se alguém chamar um
 *     cliente de provedor de fora da camada de integração. Não depende de
 *     ninguém lembrar da regra, e pega integração que ainda não existe.
 *  2. TESTE DE COMPORTAMENTO. Exercita o portal com um provedor controlável nos
 *     dez cenários que ameaçam uma escrita externa.
 *
 * O provedor falso NÃO é um mock do que está sendo auditado. O que está sob
 * teste é o PORTAL; o provedor é o mundo, e o mundo precisa ser controlável para
 * que "resposta perdida" e "aceitou mas não entregou" possam existir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { PortalEfeitos, type Integracao, type RespostaProvedor } from '../servidor/nucleo/kernel/PortalEfeitos';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';
import { integracaoWhatsapp, ID_WHATSAPP_RESPONDER } from '../servidor/nucleo/kernel/integracoes/whatsapp';
import { INTEGRACOES } from '../servidor/nucleo/kernel/integracoes';

const RAIZ = process.cwd();

function jornal(): { registro: RegistroOperacoes; raiz: string } {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-fronteira-'));
  return { registro: new RegistroOperacoes(raiz), raiz };
}

/** Windows exige `file://` em specifier ESM absoluto — caminho cru vira
 *  `ERR_UNSUPPORTED_ESM_URL_SCHEME` com protocolo "c:". */
const urlDe = (relativo: string) => pathToFileURL(path.join(RAIZ, relativo)).href;

function fontes(dir: string): string[] {
  const saida: string[] = [];
  const andar = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) saida.push(p);
    }
  };
  andar(dir);
  return saida;
}

// ===========================================================================
// 1. TESTE DE ARQUITETURA — a regra que sobrevive a quem não a conhece
// ===========================================================================

test('A1. o cliente do provedor WhatsApp só é importado pela integração', () => {
  /**
   * `entregarTexto` faz POST ao Graph. Quem a importa alcança a Meta.
   *
   * A lista de autorizados tem UM arquivo. Se amanhã alguém achar mais prático
   * chamá-la direto do canal — que foi exatamente o defeito original — este
   * teste cai antes do code review.
   */
  const AUTORIZADOS = [
    path.join('servidor', 'nucleo', 'kernel', 'integracoes', 'whatsapp.ts'),
    path.join('servidor', 'canais', 'WhatsApp.ts'), // o próprio módulo
  ];

  const infratores = fontes(path.join(RAIZ, 'servidor'))
    .filter((f) => /\bentregarTexto\b/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(RAIZ, f))
    .filter((f) => !AUTORIZADOS.includes(f));

  assert.deepEqual(
    infratores,
    [],
    `estes arquivos alcançam o Graph por fora da integração: ${infratores.join(', ')}`,
  );
});

test('A2. nenhum `fetch` a provedor externo fora da camada de integração', () => {
  /**
   * Regra estrutural, não lista de nomes. Qualquer `fetch` em `servidor/` tem
   * que estar num arquivo declarado — e a declaração exige justificativa
   * escrita aqui, que é o ponto: acrescentar uma rota externa passa a custar uma
   * conversa em vez de uma linha.
   */
  const PERMITIDOS: Record<string, string> = {
    [path.join('servidor', 'canais', 'WhatsApp.ts')]:
      'cliente do provedor; só a integração o importa (ver A1)',
    [path.join('servidor', 'nucleo', 'BuscaWeb.ts')]:
      'LEITURA — busca na web, sem efeito no mundo',
    [path.join('servidor', 'nucleo', 'OrquestradorAcoes.ts')]:
      'LEITURA — previsão do tempo, sem efeito no mundo',
    [path.join('servidor', 'nucleo', 'Voz.ts')]:
      'LEITURA — síntese de voz: texto entra, áudio sai, nada muda no mundo',
    [path.join('servidor', 'nucleo', 'Transcricao.ts')]:
      'LEITURA — transcrição de fala: áudio entra, texto sai, nada muda no ' +
      'mundo. É o espelho do `Voz.ts`, e a diferença que importa não é de ' +
      'efeito e sim de CONTEÚDO: o que sai daqui é a voz do operador, não a ' +
      'resposta da IARA. Ver a entrada em `Fronteira.ts`, que refaz a ' +
      'classificação em vez de herdá-la do vizinho.',
    [path.join('servidor', 'braco', 'pareamento.ts')]:
      'ESTADO INTERNO — o cliente das rotas /parear/* do motor da própria ' +
      'IARA. Não é rota para provedor de terceiro: é este computador pedindo ' +
      'um código e perguntando se já o autorizaram. Ver a entrada dele em ' +
      '`Fronteira.ts`, que refaz a classificação em vez de herdá-la do vizinho.',
    [path.join('servidor', 'braco', 'credencial.ts')]:
      'ESTADO INTERNO — renovação da sessão DESTE computador no auth do ' +
      'Supabase. Não é rota para provedor de terceiro: é a IARA se identificando, ' +
      'do mesmo jeito que o navegador da operadora faz sozinho. Ver a entrada ' +
      'dele em `Fronteira.ts`, que registra por que a classificação como efeito ' +
      'externo foi tentada e recusada.',
    [path.join('servidor', 'nucleo', 'ClienteGraph.ts')]:
      'LEITURA — e-mail e busca no SharePoint via Microsoft Graph, sem efeito ' +
      'no mundo. O POST de `/search/query` é consulta, não escrita — ver a ' +
      'entrada dele em `Fronteira.ts` (`POST_SEM_EFEITO`).',
    [path.join('servidor', 'nucleo', 'ClienteOllama.ts')]:
      'LEITURA — inferência local via Ollama: o prompt entra, o texto volta ' +
      'em stream, nada muda no mundo. O servidor é o da máquina do operador ' +
      'ou da rede privada dele, declarado em OLLAMA_URL — nunca descoberto. ' +
      'Ver a entrada dele em `Fronteira.ts` (`POST_SEM_EFEITO`).',
    [path.join('servidor', 'nucleo', 'ClienteCompativelOpenAI.ts')]:
      'LEITURA — inferência nas camadas gratuitas (Groq, Gemini), que falam o ' +
      'mesmo dialeto `/chat/completions`: o prompt entra, o texto volta em ' +
      'stream, nada muda no mundo. Chave DECLARADA (GROQ_API_KEY / ' +
      'GEMINI_API_KEY), nunca descoberta — a mesma disciplina do Ollama. ' +
      'Nasceu do incidente de cota de 15/08/2026; ver `CadeiaDeRaciocinio`.',
    [path.join('servidor', 'nucleo', 'ClienteWhatsapp.ts')]:
      'EFEITO EXTERNO — envio proativo de WhatsApp pelo desenho R2 de ' +
      '`enviar_whatsapp`/`resolver_confirmacao` (arma pendência, exige ' +
      '"confirmo", só então chama a Meta). Só `AgenteLocal.ts` o importa, que ' +
      'já é EFEITO EXTERNO e só é alcançado pelo catálogo — ver a entrada dele ' +
      'em `Fronteira.ts` e o porteiro correspondente em `G3`.',
    [path.join('servidor', 'braco', 'principal.ts')]:
      'LEITURA — Etapa 2 do sistema de atualização (14/08/2026). Baixa o ' +
      '`.exe` novo de um endereço que o MOTOR mandou (nunca escolhido pelo ' +
      'braço), e o download em si não tem efeito sobre ninguém: são bytes ' +
      'lidos, verificados por SHA256 antes de qualquer coisa acontecer. O ' +
      'efeito real — trocar o executável — está isolado no `spawn` do ' +
      'script de religamento, já justificado na entrada deste mesmo arquivo ' +
      'em `A4`.',
    [path.join('servidor', 'nucleo', 'ClientePlanilhaOcis.ts')]:
      'LEITURA — a planilha de OCIs da operação LUFT, via Microsoft Graph ' +
      '(`/driveItem` e `/range`, só GET). Nasceu em 14/08/2026 sem esta ' +
      'declaração e a suíte acusou — que é exatamente o funcionamento ' +
      'desejado deste teste. Nenhuma escrita: a habilidade correspondente ' +
      'tem `idempotencia: leitura` e o cliente não conhece verbo de POST ' +
      'sobre a planilha.',
    [path.join('servidor', 'nucleo', 'DiagnosticoProvedores.ts')]:
      'LEITURA — a sonda do painel de cérebros (16/08/2026). Um GET que LISTA ' +
      'modelos em cada provedor (`/v1/models`, `/api/tags`): corpo vazio, nada ' +
      'criado, nada alterado, e NENHUM conteúdo do operador atravessa — o que ' +
      'sai é a chave de API no cabeçalho, para o mesmo provedor que já a recebe ' +
      'em toda inferência. Existe justamente para NÃO precisar gastar um pedido ' +
      'de raciocínio só para descobrir se a chave é aceita. Não enxerga cota, e ' +
      'o módulo diz isso em voz alta em vez de deixar a linha verde ser lida ' +
      'como saldo — ver `combinar` e o teste do saldo não sondável.',
  };

  const comFetch = fontes(path.join(RAIZ, 'servidor'))
    .filter((f) => /\bfetch\(/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(RAIZ, f));

  const naoDeclarados = comFetch.filter((f) => !(f in PERMITIDOS));
  assert.deepEqual(
    naoDeclarados,
    [],
    `rota externa não declarada na fronteira: ${naoDeclarados.join(', ')}`,
  );
});

test('A3. `PortaWhatsapp` não importa mais o cliente do provedor', () => {
  const fonte = readFileSync(path.join(RAIZ, 'servidor/canais/PortaWhatsapp.ts'), 'utf8');
  assert.doesNotMatch(fonte, /\bentregarTexto\b/, 'o canal voltou a falar com o Graph direto');
  assert.match(fonte, /portal\.executar|\.executar\(\{/, 'o canal precisa passar pelo portal');
});

test('A4. shell e filesystem mutável continuam confinados ao AgenteLocal', () => {
  const PERMITIDOS = [
    path.join('servidor', 'nucleo', 'AgenteLocal.ts'), // spawn + mkdir, via habilidades
    path.join('servidor', 'nucleo', 'MemoriaOperacional.ts'), // shard do operador
    /**
     * Agenda de lembretes. Escreve em `dados/agenda/`, do lado do motor, pela
     * mesma razão e com a mesma forma do shard de memória logo acima: é o
     * registro da IARA sobre um compromisso do operador, não um efeito que
     * alguém de fora perceba. Não abre `child_process` e não alcança o
     * `AgenteLocal` — `G1` prova isso pelo grafo, não pela boa-fé desta linha.
     */
    path.join('servidor', 'nucleo', 'Agenda.ts'),
    path.join('servidor', 'nucleo', 'kernel', 'RegistroOperacoes.ts'), // o próprio jornal
    /**
     * A DECLARAÇÃO da fronteira. Ela cita os nomes dos padrões proibidos dentro
     * dos próprios comentários, então uma checagem textual sempre a acusa de si
     * mesma. A isenção é merecida e provada em `G4c`: o arquivo não importa nada
     * e não tem aresta no grafo.
     */
    path.join('servidor', 'nucleo', 'Fronteira.ts'),
    /**
     * O BRAÇO SE ATUALIZANDO — Etapa 2 do sistema de atualização (14/08/2026).
     * `spawn` aqui NÃO é o motor alcançando o mundo em nome de alguém, que é
     * exatamente o que este teste existe para impedir: é um processo que já
     * roda na máquina da própria operadora, com as mãos que ela mesma
     * autorizou ao instalar e parear o programa, trocando a própria versão.
     * A distinção que importa — "quem autorizou isto?" — já foi respondida
     * no pareamento; não há uma segunda porta de efeito se abrindo aqui, há
     * o braço se automantendo. `writeFileSync` (não capturado pelo regex
     * deste teste, que mira `writeFile(` assíncrono) grava só o script de
     * religamento, num arquivo temporário do sistema — nunca no disco do
     * operador que as habilidades tocam.
     */
    path.join('servidor', 'braco', 'principal.ts'),
  ];
  const infratores = fontes(path.join(RAIZ, 'servidor'))
    .filter((f) => /\bspawn\(|\bexecFile\(|\bwriteFile\(|\bappendFile\(|\bmkdir\(/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(RAIZ, f))
    .filter((f) => !PERMITIDOS.includes(f));

  assert.deepEqual(infratores, [], `efeito local fora da fronteira: ${infratores.join(', ')}`);
});

test('A5. toda integração declara risco, semântica e timeout', () => {
  for (const i of INTEGRACOES) {
    assert.ok(i.id && i.nome, `integração sem identidade: ${JSON.stringify(i)}`);
    assert.ok(['baixo', 'medio', 'alto'].includes(i.risco), `${i.id}: risco inválido`);
    assert.notEqual(
      i.semantica,
      'efeito_desconhecido',
      `${i.id} não sabe o que a repetição causa e mesmo assim está no catálogo`,
    );
    assert.ok(i.timeout_ms > 0, `${i.id}: sem relógio`);
  }
});

test('A6. a integração WhatsApp não tem autoridade para declarar verdade', () => {
  /**
   * Um adaptador que implementasse `verificar` devolvendo `confirmado: true` a
   * partir da própria resposta do provedor seria o recibo confirmando o recibo.
   * Hoje ela deliberadamente NÃO implementa — e a operação descansa em
   * `aceita_pelo_provedor`.
   */
  assert.equal(
    typeof integracaoWhatsapp.verificar,
    'undefined',
    'a Cloud API não oferece leitura da mensagem enviada; um verificador aqui seria teatro',
  );
  assert.equal(integracaoWhatsapp.semantica, 'escrita_nao_idempotente');
});

// ===========================================================================
// 2. O PROVEDOR CONTROLÁVEL
// ===========================================================================

class Provedor {
  readonly entregues: string[] = [];
  quantas(texto: string): number {
    return this.entregues.filter((e) => e === texto).length;
  }
}

type ModoProvedor =
  | 'ACEITA'
  | 'RECUSA'
  | 'TIMEOUT'
  | 'ACEITA_SEM_RESPOSTA'
  | 'EXPLODE_APOS_ENTREGAR';

type ModoVerificador = 'AUSENTE' | 'CONFIRMA' | 'NAO_ENCONTRADO' | 'DIVERGENTE';

const pendurar = () => new Promise<never>(() => {});

function integracaoFalsa(o: {
  provedor: Provedor;
  modo: ModoProvedor;
  verificador: ModoVerificador;
  risco?: 'baixo' | 'medio' | 'alto';
}): Integracao {
  const base: Integracao = {
    id: 'falsa.enviar',
    nome: 'provedor de laboratório',
    risco: o.risco ?? 'medio',
    semantica: 'escrita_nao_idempotente',
    timeout_ms: 60,
    /** O contrato exigido de toda integração — ver `PortalEfeitos.Integracao`. */
    esquema: {
      telefone: { tipo: 'texto', obrigatorio: true },
      texto: { tipo: 'texto', obrigatorio: true },
    },
    async executar(pedido): Promise<RespostaProvedor> {
      if (o.modo === 'RECUSA') {
        return { aceito: false, detalhe: 'o provedor rejeitou o destinatário' };
      }
      if (o.modo === 'TIMEOUT') return pendurar();

      o.provedor.entregues.push(String(pedido.parametros.texto));

      if (o.modo === 'EXPLODE_APOS_ENTREGAR') throw new Error('socket cortado após entregar');
      if (o.modo === 'ACEITA_SEM_RESPOSTA') return pendurar();
      return { aceito: true, referencia: `ref-${o.provedor.entregues.length}`, detalhe: 'aceito' };
    },
  };

  if (o.verificador === 'AUSENTE') return base;

  return {
    ...base,
    async verificar(resposta) {
      if (o.verificador === 'CONFIRMA') {
        return { confirmado: true, evidencia: `o provedor lista ${resposta.referencia}` };
      }
      if (o.verificador === 'NAO_ENCONTRADO') {
        return {
          confirmado: false,
          evidencia: 'sem meio de consultar o status',
          motivo: 'sem_meio_de_verificar' as const,
        };
      }
      return {
        confirmado: false,
        evidencia: 'o provedor aceitou mas não há registro da mensagem',
        motivo: 'divergente' as const,
      };
    },
  };
}

function portalCom(registro: RegistroOperacoes, integracao: Integracao): PortalEfeitos {
  const p = new PortalEfeitos(registro);
  p.registrar(integracao);
  return p;
}

const ENVIO = (origem: string, texto: string = 'oi') => ({
  integracao: 'falsa.enviar',
  id_usuario: 'ana',
  sessao: 'whatsapp:ana',
  parametros: { telefone: '5565999', texto },
  origem_pedido: origem,
  fonte_autorizacao: 'operador' as const,
  motivo_autorizacao: 'mensagem recebida do operador',
});

// ===========================================================================
// 3. OS DEZ CENÁRIOS DE ESCRITA EXTERNA
// ===========================================================================

test('1. autorização válida → provedor aceita → verificador confirma → VERIFICADA', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA' }));

  const r = await portal.executar(ENVIO('msg-1'));
  assert.equal(r.tipo, 'executada');
  assert.equal(provedor.quantas('oi'), 1);
  assert.equal(r.tipo === 'executada' && r.operacao.estado, 'verificada');
});

test('2. ACEITE NÃO É ENTREGA: sem verificador, descansa em aceita_pelo_provedor', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'AUSENTE' }));

  const r = await portal.executar(ENVIO('msg-2'));
  assert.equal(r.tipo, 'executada');
  const op = r.tipo === 'executada' ? r.operacao : null;
  assert.equal(op!.estado, 'aceita_pelo_provedor', `virou "${op!.estado}"`);
  assert.notEqual(op!.estado, 'verificada', 'um 200 do provedor virou verdade sobre o mundo');
  assert.equal(op!.historico.at(-1)?.fonte, 'provedor');
});

test('3. RETRY: mesma origem de pedido não entrega duas vezes', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA' }));

  await portal.executar(ENVIO('msg-3'));
  const segunda = await portal.executar(ENVIO('msg-3'));

  assert.equal(provedor.quantas('oi'), 1, 'a reentrega do webhook duplicou a mensagem');
  assert.equal(segunda.tipo, 'recusada');
});

test('4. DUPLICAÇÃO DE EVENTO: dois ids diferentes, mesmo conteúdo, em segundos', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA' }));

  await portal.executar(ENVIO('msg-4a'));
  await portal.executar(ENVIO('msg-4b'));

  assert.equal(provedor.quantas('oi'), 1, 'duplo envio idêntico em segundos passou');
});

test('5. TIMEOUT → UNKNOWN, e a repetição fica bloqueada', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'TIMEOUT', verificador: 'CONFIRMA' }));

  const r = await portal.executar(ENVIO('msg-5'));
  assert.equal(r.tipo, 'recusada');
  const op = registro.todas().find((o) => o.habilidade === 'falsa.enviar')!;
  assert.equal(op.estado, 'desconhecida', `virou "${op.estado}"`);
  assert.notEqual(op.estado, 'falhou', 'timeout virou falha, e falha autoriza retry duplicador');
});

test('6. RESPOSTA PERDIDA: provedor recebeu, IARA não soube → UNKNOWN, sem repetir', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA_SEM_RESPOSTA', verificador: 'CONFIRMA' }));

  await portal.executar(ENVIO('msg-6a'));
  assert.equal(provedor.quantas('oi'), 1, 'pré-condição: o provedor recebeu');

  const op = registro.todas().find((o) => o.habilidade === 'falsa.enviar')!;
  assert.equal(op.estado, 'desconhecida');

  // A IARA insiste. A regra de ouro do retry tem que segurar.
  const insiste = await portal.executar(ENVIO('msg-6b'));
  assert.equal(insiste.tipo, 'recusada');
  assert.equal(provedor.quantas('oi'), 1, 'REPETIU um envio cujo resultado é desconhecido');
});

test('7. EXPLODE APÓS ENTREGAR: o efeito existe e o estado é honesto', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'EXPLODE_APOS_ENTREGAR', verificador: 'CONFIRMA' }));

  await portal.executar(ENVIO('msg-7'));
  assert.equal(provedor.quantas('oi'), 1);
  const op = registro.todas().find((o) => o.habilidade === 'falsa.enviar')!;
  assert.equal(op.estado, 'desconhecida', 'a exceção apagou um efeito que existe');
});

test('8. PROVEDOR REJEITA → FALHOU, e pode tentar de novo', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'RECUSA', verificador: 'CONFIRMA' }));

  const r = await portal.executar(ENVIO('msg-8a'));
  assert.equal(r.tipo, 'recusada');
  const op = registro.todas().find((o) => o.habilidade === 'falsa.enviar')!;
  assert.equal(op.estado, 'falhou', `virou "${op.estado}"`);
  assert.equal(provedor.quantas('oi'), 0);

  // Recusa limpa NÃO bloqueia: nada aconteceu, e o operador pode corrigir.
  const provedor2 = new Provedor();
  const portal2 = portalCom(registro, integracaoFalsa({ provedor: provedor2, modo: 'ACEITA', verificador: 'CONFIRMA' }));
  const denovo = await portal2.executar(ENVIO('msg-8b'));
  assert.equal(denovo.tipo, 'executada', 'uma recusa limpa impediu a correção');
});

test('9. VERIFICADOR CONTRADIZ O PROVEDOR: aceito + não encontrado = FALHOU', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'DIVERGENTE' }));

  const r = await portal.executar(ENVIO('msg-9'));
  const op = r.tipo === 'executada' ? r.operacao : null;
  assert.equal(op!.estado, 'falhou', 'o provedor disse sim, o mundo disse não, e o "sim" venceu');
});

test('10. sem meio de verificar NÃO rebaixa o aceite para desconhecida', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'NAO_ENCONTRADO' }));

  const r = await portal.executar(ENVIO('msg-10'));
  const op = r.tipo === 'executada' ? r.operacao : null;
  assert.equal(
    op!.estado,
    'aceita_pelo_provedor',
    '"o provedor aceitou e não há como conferir" sabe mais que "não sei de nada"',
  );
});

test('10b. o aceite não verificado BLOQUEIA a repetição — e pela regra de ouro', async () => {
  /**
   * Achado atacando a correção: nenhum teste provava isto, e a mutação que
   * removia `aceita_pelo_provedor` da regra de ouro passava com 23/23 verdes.
   * A janela de duplo clique escondia o buraco, exatamente como escondeu a dedup
   * por chave na auditoria anterior. Duas barreiras, uma some, ninguém nota.
   *
   * A asserção é sobre o TIPO da reserva, não sobre o efeito: `bloqueada` é a
   * regra de ouro, `duplicada` é a janela de tempo. Distinguir é o que isola o
   * mecanismo — passados 20 segundos, só a regra de ouro continua de pé, e é ela
   * que impede o reenvio de uma mensagem que a Meta aceitou e ninguém confirmou.
   */
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'AUSENTE' }));

  await portal.executar(ENVIO('msg-10b'));
  const op = registro.todas().find((o) => o.habilidade === 'falsa.enviar')!;
  assert.equal(op.estado, 'aceita_pelo_provedor', 'pré-condição');

  const reserva = registro.reservar({
    id_usuario: 'ana',
    sessao: 'whatsapp:ana',
    habilidade: 'falsa.enviar',
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    parametros: { telefone: '5565999', texto: 'oi' },
    origem_pedido: 'turno-muito-depois',
  });
  assert.equal(
    reserva.tipo,
    'bloqueada',
    `um aceite não confirmado só está protegido pela janela de 20s (veio "${reserva.tipo}")`,
  );
});

test('11. SEM AUTORIZAÇÃO DE OPERADOR: risco alto não passa nem pelo portal', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(
    registro,
    integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA', risco: 'alto' }),
  );

  const r = await portal.executar({ ...ENVIO('msg-11'), fonte_autorizacao: 'porteiro' });
  assert.equal(r.tipo, 'recusada', 'o porteiro autorizou sozinho um envio de risco alto');
  assert.equal(provedor.quantas('oi'), 0);
});

test('12. integração indisponível não alcança o provedor', async () => {
  const { registro } = jornal();
  const portal = new PortalEfeitos(registro);
  portal.registrar({
    ...integracaoFalsa({ provedor: new Provedor(), modo: 'ACEITA', verificador: 'CONFIRMA' }),
    indisponivelPorque: () => 'falta credencial',
  });
  const r = await portal.executar(ENVIO('msg-12'));
  assert.equal(r.tipo, 'recusada');
  assert.match(r.tipo === 'recusada' ? r.motivo : '', /indisponível/);
});

// ===========================================================================
// 3b. ORIGEM CONFIÁVEL — o P0 que a auditoria de terceira ordem criou e pegou
// ===========================================================================

test('12b. P0: duas mensagens DIFERENTES com a mesma resposta são as duas enviadas', async () => {
  /**
   * DEFEITO CRIADO PELA PRÓPRIA CORREÇÃO, e o pior tipo: silencioso e permanente.
   *
   * A resposta do canal não tem verificador, então toda resposta descansa em
   * `aceita_pelo_provedor`. Pela regra de ouro, qualquer resposta futura com o
   * mesmo TEXTO era bloqueada — para sempre, porque `aceita_pelo_provedor` não
   * expira. Na prática: a IARA responderia "Bom dia! Como posso ajudar?" uma
   * única vez na vida e depois emudeceria, sem erro, sem log de recusa visível
   * ao operador.
   *
   * A correção é `origem_confiavel`: o `wamid` identifica a intenção sozinho, e
   * as heurísticas de impressão digital saem do caminho. Este teste é a metade
   * que prova que a IARA continua FALANDO.
   */
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'AUSENTE' }));

  const resposta = 'Bom dia! Como posso ajudar?';
  const env = (wamid: string) => ({ ...ENVIO(wamid, resposta), origem_confiavel: true });

  const a = await portal.executar(env('wamid-1'));
  const b = await portal.executar(env('wamid-2'));

  assert.equal(a.tipo, 'executada');
  assert.equal(b.tipo, 'executada', 'a segunda pergunta ficou sem resposta');
  assert.equal(provedor.quantas(resposta), 2, 'a IARA emudeceu ao repetir uma frase');
});

test('12c. e a REENTREGA do mesmo evento continua deduplicada', async () => {
  /**
   * A outra metade. `origem_confiavel` desliga as heurísticas, NÃO a barreira
   * de chave — que é a que realmente protege contra a reentrega do webhook, e a
   * única que sobrevive a restart. Sem este teste, a correção acima poderia ter
   * desligado a proteção inteira e ninguém notaria.
   */
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'AUSENTE' }));
  const env = { ...ENVIO('wamid-repetido', 'oi'), origem_confiavel: true };

  await portal.executar(env);
  const reentrega = await portal.executar(env);

  assert.equal(reentrega.tipo, 'recusada', 'a reentrega da Meta duplicou a mensagem');
  assert.equal(provedor.quantas('oi'), 1);
});

test('12d. ARQUITETURA: só quem tem id de provedor declara origem confiável', () => {
  /**
   * `origem_confiavel` desliga duas barreiras. Ligá-lo sem um identificador
   * único por intenção reabre o duplo envio — e é uma linha fácil de copiar de
   * um lugar para outro. A lista tem os arquivos onde isso é justificado.
   */
  const AUTORIZADOS = [path.join('servidor', 'canais', 'PortaWhatsapp.ts')];
  const infratores = fontes(path.join(RAIZ, 'servidor'))
    .filter((f) => /origem_confiavel:\s*true/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(RAIZ, f))
    .filter((f) => !AUTORIZADOS.includes(f));

  assert.deepEqual(
    infratores,
    [],
    `desligaram a proteção de duplicidade sem id de provedor: ${infratores.join(', ')}`,
  );
});

// ===========================================================================
// 4. CONCORRÊNCIA E RESTART NA FRONTEIRA
// ===========================================================================

test('13. CONCORRÊNCIA: duas entregas simultâneas do mesmo evento → uma só', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA' }));

  await Promise.all([portal.executar(ENVIO('msg-13')), portal.executar(ENVIO('msg-13'))]);
  assert.equal(provedor.quantas('oi'), 1, 'a corrida entregou duas vezes');
});

test('14. RESTART: a reentrega da Meta depois do reinício não duplica', async () => {
  const { registro, raiz } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA' }));
  await portal.executar(ENVIO('wamid-abc'));
  assert.equal(provedor.quantas('oi'), 1);

  // O processo morre. `jaVistas` (o Map de 10 min) some com ele — era isto que
  // deixava a reentrega passar.
  const depois = new RegistroOperacoes(raiz);
  await depois.reidratar('ana');
  const portalDepois = portalCom(depois, integracaoFalsa({ provedor, modo: 'ACEITA', verificador: 'CONFIRMA' }));

  const reentrega = await portalDepois.executar(ENVIO('wamid-abc'));
  assert.equal(reentrega.tipo, 'recusada', 'a reentrega pós-restart passou');
  assert.equal(provedor.quantas('oi'), 1, 'o operador recebeu a mesma resposta duas vezes');
});

// ===========================================================================
// 5. CRASH REAL — SIGKILL em processo isolado (Fase 14)
// ===========================================================================

/**
 * Sobe um processo NOVO, faz ele gravar `executando` no jornal, e o mata com
 * `SIGKILL` — que não é interceptável, não roda `finally`, não roda handler.
 *
 * Não é o processo de teste que morre: é um filho isolado, com jornal próprio em
 * diretório temporário. Isso é o que separa "crash testado" de "crash simulado",
 * e a diferença importa porque a garantia sob teste é justamente sobre o momento
 * em que o programa perde o controle.
 *
 * O especificador precisa ser `file://`: no Windows, um caminho absoluto cru no
 * `import` de um módulo ESM vira `ERR_UNSUPPORTED_ESM_URL_SCHEME` com protocolo
 * "c:", e o filho morre por erro de carga em vez de por SIGKILL — o teste
 * passaria a provar outra coisa.
 */
function matarProcessoNoMeioDaEscrita(marca: string): { raiz: string; morreu: boolean } {
  const raiz = mkdtempSync(path.join(tmpdir(), `iara-sigkill-${marca}-`));
  const roteiro = `
    import { RegistroOperacoes } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/RegistroOperacoes.ts'))};
    import { evidencia } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/Operacao.ts'))};
    const r = new RegistroOperacoes(${JSON.stringify(raiz)});
    const reserva = r.reservar({
      id_usuario: 'ana', sessao: 's', habilidade: 'falsa.enviar', risco: 'medio',
      semantica: 'escrita_nao_idempotente', parametros: { texto: 'oi' }, origem_pedido: ${JSON.stringify(marca)},
    });
    const id = reserva.operacao.id_operacao;
    await r.marcar(id, 'autorizada', evidencia('operador', 'pediu'));
    await r.marcar(id, 'executando', evidencia('executor', 'jornal antes do efeito'));
    process.kill(process.pid, 'SIGKILL');
  `;
  const arquivo = path.join(raiz, 'suicida.mts');
  writeFileSync(arquivo, roteiro, 'utf8');

  let morreu = false;
  try {
    execFileSync(process.execPath, ['--import', 'tsx', arquivo], { stdio: 'pipe', timeout: 60_000 });
  } catch {
    morreu = true; // SIGKILL faz `execFileSync` lançar. É o esperado.
  }
  return { raiz, morreu };
}

test('15. CRASH REAL (SIGKILL): o jornal sobrevive e volta como DESCONHECIDA', () => {
  /**
   * CRASH DE VERDADE, não simulação. Um processo filho grava `executando` no
   * jornal e então se mata com `SIGKILL` — sem `finally`, sem handler, sem
   * chance de escrever mais nada. É o cenário que nenhuma simulação reproduz
   * fielmente: o `SIGKILL` não é interceptável.
   *
   * O que se prova: o registro de intenção chega ao disco ANTES do efeito, e a
   * reidratação de um processo NOVO encontra a operação e a devolve como
   * `desconhecida` — nunca como falha, nunca como sucesso, nunca como silêncio.
   */
  const { raiz, morreu } = matarProcessoNoMeioDaEscrita('crash');
  assert.ok(morreu, 'o processo filho deveria ter sido morto por SIGKILL');

  // O jornal está no disco, escrito por um processo que não existe mais.
  const linhas = readFileSync(path.join(raiz, 'ana.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.ok(linhas.length >= 2, `o jornal do processo morto tem ${linhas.length} linha(s)`);
  assert.equal((JSON.parse(linhas.at(-1)!) as { estado: string }).estado, 'executando');
});

test('15b. depois do SIGKILL, um processo NOVO reconstrói a verdade do disco', async () => {
  const { raiz } = matarProcessoNoMeioDaEscrita('crash2');

  const depois = new RegistroOperacoes(raiz);
  const recuperadas = await depois.reidratar('ana');
  assert.equal(recuperadas.length, 1);
  assert.equal(recuperadas[0].estado, 'desconhecida', `voltou como "${recuperadas[0].estado}"`);
  assert.equal(recuperadas[0].historico.at(-1)?.fonte, 'reidratacao');

  // E o efeito não pode ser repetido sem alguém consultar o mundo.
  assert.equal(
    depois.reservar({
      id_usuario: 'ana',
      sessao: 's',
      habilidade: 'falsa.enviar',
      risco: 'medio',
      semantica: 'escrita_nao_idempotente',
      parametros: { texto: 'oi' },
      origem_pedido: 'pos-crash',
    }).tipo,
    'bloqueada',
    'depois de um SIGKILL real a IARA repetiria o efeito',
  );
});

// ===========================================================================
// 6. O CONTRATO DO WHATSAPP REAL
// ===========================================================================

test('16. a integração WhatsApp real está no catálogo e se declara indisponível sem credencial', () => {
  assert.ok(
    INTEGRACOES.some((i) => i.id === ID_WHATSAPP_RESPONDER),
    'a integração de resposta do WhatsApp saiu do catálogo',
  );
  const token = process.env.WHATSAPP_TOKEN;
  const phone = process.env.WHATSAPP_PHONE_ID;
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID;
  try {
    assert.match(
      integracaoWhatsapp.indisponivelPorque?.() ?? '',
      /WHATSAPP_TOKEN/,
      'sem credencial a integração precisa se declarar indisponível, não falhar no meio',
    );
  } finally {
    if (token) process.env.WHATSAPP_TOKEN = token;
    if (phone) process.env.WHATSAPP_PHONE_ID = phone;
  }
});
