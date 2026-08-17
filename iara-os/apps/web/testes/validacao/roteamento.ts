/**
 * BATERIA — ROTEAMENTO DE MODELO CONTRA MODELO FIXO.
 *
 * A pergunta da Fase 12 é comparativa, e é a única que importa aqui:
 *
 *     o roteador melhora qualidade, custo ou latência — ou só parece mais esperto?
 *
 * A RESPOSTA MEDIDA É "NENHUM DOS TRÊS, E ELE NÃO PROMETE ISSO". `CadeiaDeRaciocinio`
 * não é um roteador: é uma cadeia de FAILOVER com saúde. Ela percorre os elos numa
 * ordem declarada, pula quem está em carência, e não olha a tarefa, o custo nem a
 * privacidade para decidir. Chamá-la de roteador e reprovar por não rotear seria
 * medir a etiqueta em vez do produto — o mesmo erro que a bateria de RAG evita ao
 * não cobrar semântica de busca lexical.
 *
 * Então esta bateria mede o que a cadeia REALMENTE promete, com três elos de
 * laboratório de perfis diferentes:
 *
 *   1. failover funciona     — elo que quebra não impede a resposta;
 *   2. carência é respeitada — quem falhou recentemente não é tentado primeiro;
 *   3. ordem é estável       — sem falha, a escolha não varia entre chamadas;
 *   4. CARACTERIZAÇÃO        — o elo escolhido NÃO muda com o custo nem com o
 *                              tamanho da tarefa. É o que falta para virar roteador,
 *                              medido em vez de afirmado.
 *
 * A caracterização é o valor real deste arquivo: no dia em que alguém propuser
 * roteamento por custo, o antes existe em número.
 */

import {
  CadeiaDeRaciocinio,
  limparFalhasObservadas,
  registrarFalhaProvedor,
} from '../../servidor/nucleo/CadeiaDeRaciocinio';
import type { ProvedorRaciocinio } from '../../servidor/nucleo/ProvedorRaciocinio';

interface PerfilDeElo {
  readonly apelido: string;
  /** Custo relativo por 1k tokens. Só para a comparação — ninguém cobra aqui. */
  readonly custo: number;
  readonly ms: number;
  readonly quebra: boolean;
}

const PERFIS: readonly PerfilDeElo[] = [
  { apelido: 'caro-e-bom', custo: 15, ms: 40, quebra: false },
  { apelido: 'medio', custo: 3, ms: 20, quebra: false },
  { apelido: 'barato-e-local', custo: 0, ms: 5, quebra: false },
];

function elo(perfil: PerfilDeElo, registro: string[]): ProvedorRaciocinio {
  return {
    apelido: perfil.apelido,
    modelo: perfil.apelido,
    origem: 'local',
    disponivel: true,
    async sondar() {
      return true;
    },
    async raciocinar(pedido: { enunciado?: string }) {
      registro.push(perfil.apelido);
      if (perfil.quebra) throw new Error('503 Service Unavailable');
      await new Promise((r) => setTimeout(r, perfil.ms));
      return {
        texto: `resposta de ${perfil.apelido} para ${String(pedido.enunciado ?? '').slice(0, 20)}`,
        tokens_entrada: 500,
        tokens_saida: 200,
        cache_lido: 0,
        modelo: perfil.apelido,
      };
    },
  } as unknown as ProvedorRaciocinio;
}

export interface JulgamentoRoteamento {
  readonly id: string;
  readonly pergunta: string;
  readonly medido: string;
  readonly aprovado: boolean;
  /** Caracterização: não reprova, existe para virar linha de base. */
  readonly caracterizacao?: boolean;
}

const pedido = (enunciado: string) =>
  ({
    enunciado,
    historico: [],
    capacidades: '',
    contexto: '',
    aoReceberTexto() {},
  }) as never;

export async function medirRoteamento(): Promise<readonly JulgamentoRoteamento[]> {
  const js: JulgamentoRoteamento[] = [];

  // 1. FAILOVER --------------------------------------------------------------
  limparFalhasObservadas();
  let registro: string[] = [];
  const comQuebra = new CadeiaDeRaciocinio([
    elo({ ...PERFIS[0], quebra: true }, registro),
    elo(PERFIS[1], registro),
    elo(PERFIS[2], registro),
  ]);
  const r1 = await comQuebra.raciocinar(pedido('consolide o levantamento de custos'));
  js.push({
    id: 'failover-atravessa-o-elo-quebrado',
    pergunta: 'elo que quebra impede a resposta?',
    medido: `tentou [${registro.join(' → ')}] e respondeu por ${(r1 as { modelo?: string }).modelo}`,
    aprovado: registro.length >= 2 && Boolean(r1.texto),
  });

  // 2. CARÊNCIA --------------------------------------------------------------
  limparFalhasObservadas();
  registrarFalhaProvedor('caro-e-bom', new Error('429 Too Many Requests'));
  registro = [];
  const comCarencia = new CadeiaDeRaciocinio([
    elo(PERFIS[0], registro),
    elo(PERFIS[1], registro),
    elo(PERFIS[2], registro),
  ]);
  await comCarencia.raciocinar(pedido('consolide o levantamento de custos'));
  js.push({
    id: 'carencia-desce-quem-falhou',
    pergunta: 'quem falhou por cota há pouco continua sendo o primeiro tentado?',
    medido: `ordem tentada: [${registro.join(' → ')}]`,
    /* O defeito que a auditoria de 17/08 já tinha achado e consertado: a cadeia
       tentava o provedor sem crédito PRIMEIRO em todo turno, gastando 3 chamadas
       para fazer 1. Esta é a regressão desse conserto. */
    aprovado: registro[0] !== 'caro-e-bom',
  });

  // 3. ESTABILIDADE ----------------------------------------------------------
  limparFalhasObservadas();
  const escolhas: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const reg: string[] = [];
    const cadeia = new CadeiaDeRaciocinio(PERFIS.map((p) => elo(p, reg)));
    const r = await cadeia.raciocinar(pedido('consolide o levantamento de custos'));
    escolhas.push(String((r as { modelo?: string }).modelo));
  }
  js.push({
    id: 'ordem-estavel-sem-falha',
    pergunta: 'sem falha nenhuma, a escolha varia entre chamadas?',
    medido: `5 chamadas → ${[...new Set(escolhas)].join(', ')}`,
    aprovado: new Set(escolhas).size === 1,
  });

  // 4. CARACTERIZAÇÃO: não há roteamento por custo nem por tarefa -------------
  limparFalhasObservadas();
  const porTarefa: Record<string, string> = {};
  for (const tarefa of [
    'oi',
    'resuma em uma palavra',
    'faça uma análise comparativa completa de doze meses de operação com projeção',
  ]) {
    const reg: string[] = [];
    const cadeia = new CadeiaDeRaciocinio(PERFIS.map((p) => elo(p, reg)));
    const r = await cadeia.raciocinar(pedido(tarefa));
    porTarefa[tarefa.slice(0, 18)] = String((r as { modelo?: string }).modelo);
  }
  const distintos = new Set(Object.values(porTarefa)).size;
  js.push({
    id: 'nao-roteia-por-tarefa-nem-custo',
    pergunta: 'tarefa trivial e tarefa pesada caem em elos diferentes?',
    medido: `${distintos} elo(s) distinto(s) para 3 tarefas de tamanhos muito diferentes: ${JSON.stringify(porTarefa)}`,
    /**
     * APROVADO PORQUE A CADEIA NÃO PROMETE ROTEAR. Um `false` aqui diria que o
     * produto tem defeito; ele tem uma LACUNA, que é coisa diferente e está
     * declarada no registro de baterias. O número existe para o dia em que alguém
     * propuser roteamento por custo — sem ele, a proposta seria decidida por gosto,
     * e o "depois" não teria "antes".
     */
    aprovado: true,
    caracterizacao: true,
  });

  limparFalhasObservadas();
  return js;
}

export function violacoesDeRoteamento(js: readonly JulgamentoRoteamento[]): readonly string[] {
  return js
    .filter((j) => !j.aprovado && !j.caracterizacao)
    .map((j) => `${j.id}: medido ${j.medido}`);
}
