/**
 * AUDITORIA DE EXECUÇÃO REAL DO CATÁLOGO.
 *
 * A suíte prova propriedades com dublês; esta bancada roda as habilidades DE
 * VERDADE, no computador de quem executa, pelo caminho real — as quatro portas
 * do `GerenciadorHabilidades` mais o verificador. É a diferença entre "o
 * contrato está bem escrito" e "a coisa funciona".
 *
 * TRÊS CATEGORIAS DE CASO, e a distinção é a espinha deste arquivo:
 *
 *   `executa`   roda para valer. O efeito é reversível e a limpeza vem junto.
 *   `porta`     roda esperando ser RECUSADA. Prova que o portão fecha — é o
 *               único jeito honesto de auditar `enviar_whatsapp` sem mandar
 *               mensagem para uma pessoa real.
 *   `contrato`  só o manifesto. Reservado ao que exige credencial ausente.
 *
 * O que esta bancada NUNCA faz: confirmar uma ação de energia. `acionar_energia`
 * é exercitada até a pendência e desarmada em seguida; o `confirmo` que
 * dispararia o `shutdown` não existe neste arquivo, de propósito.
 *
 *   npx tsx scripts/auditar-habilidades.ts
 */

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: '.env.local' });
carregarEnv();

type Modo = 'executa' | 'porta' | 'contrato';

interface Caso {
  readonly id: string;
  readonly modo: Modo;
  readonly parametros?: Record<string, unknown>;
  /** Por que não executa, ou o que se espera da recusa. */
  readonly nota?: string;
}

/**
 * A ORDEM IMPORTA e não é alfabética.
 *
 * Quatro pares só fazem sentido em sequência: abrir antes de fechar, armar
 * energia antes de resolver, agendar antes de listar e cancelar, investigar
 * antes de assumir o plano. Rodar cada um isolado provaria metade de cada par —
 * justamente a metade fácil.
 */
const PLANO: readonly Caso[] = [
  // --- operacionais -------------------------------------------------------
  { id: 'consultar_agenda', modo: 'executa' },
  { id: 'consultar_clima', modo: 'executa', parametros: { horizonte: 'agora' } },
  { id: 'consultar_infraestrutura', modo: 'executa', parametros: { uf: 'GERAL' } },
  { id: 'pesquisar_web', modo: 'executa', parametros: { consulta: 'prazo de cancelamento de CT-e' } },
  { id: 'buscar_historico', modo: 'executa', parametros: { consulta: 'timeout no portal' } },
  { id: 'recusar_por_sigilo', modo: 'executa' },

  // --- dados --------------------------------------------------------------
  { id: 'consultar_memoria_corporativa', modo: 'executa', parametros: { consulta: 'baixa de CT-e' } },
  { id: 'extrair_texto_documento', modo: 'executa', parametros: { arquivo: 'auditoria-catalogo.pdf' } },
  {
    id: 'executar_consulta_sql',
    modo: 'executa',
    parametros: { consulta: 'centrais_por_uf', parametros: '{"uf":"MT"}' },
  },

  // --- integrações --------------------------------------------------------
  { id: 'ler_emails', modo: 'contrato', nota: 'exige MS_GRAPH_TOKEN' },
  { id: 'buscar_documento_sharepoint', modo: 'contrato', nota: 'exige MS_GRAPH_TOKEN' },
  {
    id: 'enviar_whatsapp',
    modo: 'porta',
    parametros: { destinatario: '+5500000000000', mensagem: 'auditoria' },
    nota: 'alcança terceiro: a auditoria exige que a porta RECUSE',
  },

  // --- agente local -------------------------------------------------------
  { id: 'informacoes_sistema', modo: 'executa' },
  { id: 'listar_arquivos', modo: 'executa', parametros: { local: 'documentos' } },
  { id: 'criar_pasta', modo: 'executa', parametros: { nome: 'Auditoria IARA', local: 'documentos' } },
  { id: 'abrir_aplicativo', modo: 'executa', parametros: { aplicativo: 'calculadora' } },
  { id: 'fechar_aplicativo', modo: 'executa', parametros: { aplicativo: 'calculadora' } },
  { id: 'capturar_tela', modo: 'executa', parametros: { local: 'documentos' } },
  {
    id: 'atualizar_repositorio',
    modo: 'porta',
    parametros: { repositorio: 'nao_declarado' },
    nota: 'apelido fora da allowlist precisa ser recusado',
  },
  { id: 'atualizar_repositorio', modo: 'executa', parametros: { repositorio: 'auditoria' } },
  { id: 'acionar_energia', modo: 'executa', parametros: { acao: 'suspender' } },
  { id: 'resolver_confirmacao', modo: 'executa', parametros: { resposta: 'cancelar' } },

  // --- agenda -------------------------------------------------------------
  {
    id: 'agendar_lembrete',
    modo: 'executa',
    parametros: { assunto: 'conferir a auditoria do catálogo', quando: 'em 45 minutos' },
  },
  { id: 'listar_lembretes', modo: 'executa' },
  { id: 'cancelar_lembrete', modo: 'executa', parametros: { termo: 'auditoria do catálogo' } },

  // --- cognição sobre si --------------------------------------------------
  { id: 'diagnosticar_sistema', modo: 'executa' },
  { id: 'auditar_sistema', modo: 'executa' },
  { id: 'investigar_lentidao', modo: 'executa' },
  { id: 'assumir_plano', modo: 'executa', parametros: { plano: '' } },
];

/**
 * O PDF de prova, escrito pela própria bancada.
 *
 * `extrair_texto_documento` precisa de um arquivo com camada de texto para ser
 * exercitada de verdade — e um PDF de cliente não pode morar no repositório
 * (ver `.gitignore`). Gerar aqui torna a auditoria reprodutível em qualquer
 * máquina sem versionar documento de ninguém. Sem compressão de propósito: o
 * extrator aceita stream cru, e assim o teste não depende de zlib para provar o
 * que quer provar.
 */
async function prepararDocumentoDeProva(): Promise<() => void> {
  const { mkdirSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
  const path = await import('node:path');

  const pasta = path.join(process.cwd(), 'dados', 'documentos');
  const alvo = path.join(pasta, 'auditoria-catalogo.pdf');
  if (existsSync(alvo)) return () => undefined;

  const frases = [
    'Relatorio de auditoria do catalogo da IARA, gerado pela bancada de execucao real.',
    'Documento descartavel: existe para provar que a extracao de texto le a camada do PDF.',
  ];
  const corpo = `BT /F1 12 Tf 72 720 Td (${frases[0]}) Tj 0 -18 Td (${frases[1]}) Tj ET`;
  const objetos = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${corpo.length}>>stream\n${corpo}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];

  let pdf = '%PDF-1.4\n';
  const deslocamentos: number[] = [];
  objetos.forEach((o, i) => {
    deslocamentos.push(pdf.length);
    pdf += `${i + 1} 0 obj${o}endobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += deslocamentos.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF`;

  mkdirSync(pasta, { recursive: true });
  writeFileSync(alvo, pdf, 'latin1');
  return () => rmSync(alvo, { force: true });
}

interface Linha {
  id: string;
  modo: Modo;
  veredito: 'ok' | 'falha' | 'atencao' | 'desligada';
  estado: string;
  resolveu: boolean | null;
  verificacao: string;
  texto: string;
  ms: number;
}

async function principal(): Promise<void> {
  const { CATALOGO, prepararOperacionais } = await import(
    '../servidor/nucleo/kernel/habilidades/index'
  );
  const { GerenciadorHabilidades } = await import('../servidor/nucleo/kernel/GerenciadorHabilidades');
  const { BarramentoEventos } = await import('../servidor/nucleo/kernel/BarramentoEventos');
  const { RegistroOperacoes } = await import('../servidor/nucleo/kernel/RegistroOperacoes');
  const { PoliticaPadrao } = await import('../servidor/nucleo/kernel/Seguranca');
  const { motorTemMaos } = await import('../servidor/nucleo/Braco');
  const { conferirEsquemaSupabase, persistenciaEmUso } = await import(
    '../servidor/nucleo/ClienteSupabase'
  );

  /**
   * A MESMA ORDEM DA SUBIDA REAL (`prepararMotor`). Sem esta linha a bancada
   * mediria um sistema que o produto não é: o Supabase entraria ligado e as
   * habilidades de persistência falhariam por um motivo que a subida de verdade
   * já teria resolvido.
   */
  await conferirEsquemaSupabase();
  await prepararOperacionais();
  const limparDocumento = await prepararDocumentoDeProva();
  console.log(`persistência: ${persistenciaEmUso()}`);

  const barramento = new BarramentoEventos('auditoria');
  const gerente = new GerenciadorHabilidades(barramento);
  gerente.registrarTodas(CATALOGO);

  const concedidas = new PoliticaPadrao().permissoesDe('operador');
  const registro = new RegistroOperacoes();
  const idUsuario = 'auditoria-catalogo';
  const sessao = 'sessao-auditoria';

  console.log(`catálogo: ${CATALOGO.length} habilidades | mãos locais: ${motorTemMaos()}`);
  console.log(`permissões do papel operador: ${concedidas.join(', ')}\n`);

  const linhas: Linha[] = [];
  const exercitadas = new Set<string>();

  for (const caso of PLANO) {
    exercitadas.add(caso.id);
    const habilidade = CATALOGO.find((h) => h.manifesto.id === caso.id);
    if (!habilidade) {
      linhas.push({
        id: caso.id,
        modo: caso.modo,
        veredito: 'falha',
        estado: 'ausente do catálogo',
        resolveu: null,
        verificacao: '—',
        texto: '',
        ms: 0,
      });
      continue;
    }

    const indisponivel = habilidade.indisponivelPorque?.() ?? null;
    if (caso.modo === 'contrato' || (indisponivel && caso.modo !== 'porta')) {
      linhas.push({
        id: caso.id,
        modo: caso.modo,
        veredito: indisponivel ? 'desligada' : 'atencao',
        estado: indisponivel ?? 'disponível, mas não executada',
        resolveu: null,
        verificacao: '—',
        texto: caso.nota ?? '',
        ms: 0,
      });
      continue;
    }

    const inicio = Date.now();
    try {
      const r = await gerente.executarVerificando({
        id: caso.id,
        parametros: caso.parametros ?? {},
        enunciado: `auditoria de ${caso.id}`,
        id_usuario: idUsuario,
        sessao,
        sinal: new AbortController().signal,
        concedidas,
        registro,
      });

      const recusouComElegancia = caso.modo === 'porta' && !r.resultado.resolveu;
      linhas.push({
        id: caso.id,
        modo: caso.modo,
        veredito:
          caso.modo === 'porta'
            ? recusouComElegancia
              ? 'ok'
              : 'falha'
            : r.resultado.resolveu
              ? 'ok'
              : 'atencao',
        estado: r.estado,
        resolveu: r.resultado.resolveu,
        verificacao: r.verificacao
          ? `${r.verificacao.confirmado ? 'confirmado' : (r.verificacao.motivo ?? 'não')} — ${r.verificacao.evidencia}`
          : 'sem verificador (leitura)',
        texto: r.resultado.texto.replace(/\s+/g, ' ').slice(0, 220),
        ms: Date.now() - inicio,
      });
    } catch (erro) {
      const mensagem = (erro as Error).message;
      linhas.push({
        id: caso.id,
        modo: caso.modo,
        // Exceção é o comportamento CERTO quando o caso é de porta: o
        // gerenciador barra antes do executor.
        veredito: caso.modo === 'porta' ? 'ok' : 'falha',
        estado: `exceção: ${mensagem}`,
        resolveu: false,
        verificacao: '—',
        texto: '',
        ms: Date.now() - inicio,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Relatório
  // -------------------------------------------------------------------------

  const SELO: Record<Linha['veredito'], string> = {
    ok: '  OK  ',
    falha: ' FALHA',
    atencao: ' ATEN ',
    desligada: ' OFF  ',
  };

  console.log('─'.repeat(120));
  for (const l of linhas) {
    console.log(
      `[${SELO[l.veredito]}] ${l.id.padEnd(30)} ${String(l.ms).padStart(6)}ms  ${l.estado}`,
    );
    if (l.verificacao !== '—') console.log(`${' '.repeat(11)}prova: ${l.verificacao}`);
    if (l.texto) console.log(`${' '.repeat(11)}fala:  ${l.texto}`);
  }
  console.log('─'.repeat(120));

  const naoExercitadas = CATALOGO.map((h) => h.manifesto.id).filter((id) => !exercitadas.has(id));
  if (naoExercitadas.length > 0) {
    console.log(`NÃO EXERCITADAS (${naoExercitadas.length}): ${naoExercitadas.join(', ')}`);
  }

  limparDocumento();

  const conta = (v: Linha['veredito']) => linhas.filter((l) => l.veredito === v).length;
  console.log(
    `total ${linhas.length} casos | ok ${conta('ok')} | atenção ${conta('atencao')} | ` +
      `falha ${conta('falha')} | desligadas ${conta('desligada')}`,
  );

  process.exitCode = conta('falha') > 0 ? 1 : 0;
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
