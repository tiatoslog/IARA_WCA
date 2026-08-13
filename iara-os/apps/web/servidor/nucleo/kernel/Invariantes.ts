/**
 * PROPRIEDADES CRÍTICAS — o que um erro da LLM não pode atravessar.
 *
 * A pergunta que este arquivo responde não é "a IARA responde bem?". É:
 *
 *   quando a camada de raciocínio errar — e ela vai errar —, quais consequências
 *   continuam impossíveis?
 *
 * Nenhuma técnica prova que um modelo de linguagem responde certo para toda
 * entrada. O que se pode provar é o complemento: que um conjunto declarado de
 * consequências não é alcançável a partir de NENHUMA saída da LLM, porque quem
 * as barra é código determinístico que a LLM não alimenta. Este arquivo é a
 * lista dessas consequências, e `testes/propriedades-criticas.test.ts` é a
 * prova executável de cada uma.
 *
 * O QUE ESTE ARQUIVO NÃO É:
 *
 *   Não é documentação. Documentação envelhece em silêncio — foi exatamente o
 *   defeito que a auditoria anterior encontrou em `reidratar`, onde a prosa
 *   prometia uma checagem que o código não fazia. Cada entrada aqui nomeia o
 *   ARQUIVO e o SÍMBOLO que impõe a propriedade, e a suíte falha quando o
 *   símbolo some, quando a propriedade fica sem verificação executada, ou
 *   quando uma verificação aponta para uma propriedade que ninguém declarou.
 *
 *   Também não é um portão. Este módulo não é chamado em tempo de execução e
 *   não decide nada: um segundo lugar que decide é política em dois lugares, e
 *   política em dois lugares é política em nenhum. Quem barra continua sendo
 *   `PorteiroAutorizacao`, `transicionar`, `SandboxPorPolitica`, `validar`,
 *   `emitirProva` e a derivação de shard. Aqui só está escrito, em forma
 *   conferível, O QUE eles garantem.
 *
 * LIMITE DECLARADO, e ele muda a leitura de P4/P5: a IARA é MONOLOCATÁRIA. Não
 * existe entidade "locatário" no código — existe operador, e o shard do
 * operador é a única fronteira de dados. Onde o briefing diz TENANT_A ≠
 * TENANT_B, aqui se lê OPERADOR_A ≠ OPERADOR_B. Chamar isso de isolamento
 * multi-locatário seria prometer uma separação (banco, chave, backup) que não
 * existe.
 */

export type IdPropriedade =
  | 'P1_ACAO_NAO_AUTORIZADA_NUNCA_EXECUTA'
  | 'P2_FERRAMENTA_QUE_FALHOU_NUNCA_VIRA_SUCESSO'
  | 'P3_ACAO_CANCELADA_NUNCA_EXECUTA'
  | 'P4_SHARD_ALHEIO_NUNCA_E_ALCANCADO'
  | 'P5_DONO_DO_EFEITO_NUNCA_VEM_DO_PEDIDO'
  | 'P6_FATO_DESCONHECIDO_NUNCA_VIRA_VERIFICADO'
  | 'P7_PLANO_EMERGENTE_NUNCA_EXECUTA_RISCO_ALTO'
  | 'P8_ACAO_IRREVERSIVEL_EXIGE_FALA_HUMANA';

/** Onde a propriedade é imposta. Arquivo relativo a `iara-os/apps/web`. */
export interface PontoDeImposicao {
  readonly arquivo: string;
  readonly simbolo: string;
}

export interface PropriedadeCritica {
  readonly id: IdPropriedade;
  /** A propriedade na forma antecedente ⟹ consequente. */
  readonly enunciado: string;
  /** A formulação do briefing, preservada para rastreabilidade. */
  readonly briefing: string;
  /**
   * Os pontos determinísticos que a impõem. Mais de um quando a garantia é
   * defesa em profundidade — e aí a suíte exige que CADA um seja exercitado,
   * porque uma barreira que só funciona quando a outra funciona não é uma
   * segunda barreira.
   */
  readonly imposta_por: readonly PontoDeImposicao[];
  /** O que uma violação permitiria, em termos operacionais. */
  readonly violacao_permitiria: string;
}

const K = 'servidor/nucleo/kernel';

export const PROPRIEDADES_CRITICAS: readonly PropriedadeCritica[] = [
  {
    id: 'P1_ACAO_NAO_AUTORIZADA_NUNCA_EXECUTA',
    enunciado:
      'papel sem a permissão declarada pela habilidade ⟹ a habilidade não roda, ' +
      'e a recusa acontece antes de qualquer efeito',
    briefing: 'UNAUTHORIZED_ACTION → NEVER EXECUTE',
    imposta_por: [
      { arquivo: `${K}/Seguranca.ts`, simbolo: 'SandboxPorPolitica' },
      { arquivo: `${K}/PorteiroAutorizacao.ts`, simbolo: 'PorteiroAutorizacao' },
    ],
    violacao_permitiria:
      'um operador comum disparando envio externo, ou um papel somente_leitura escrevendo no disco',
  },
  {
    id: 'P2_FERRAMENTA_QUE_FALHOU_NUNCA_VIRA_SUCESSO',
    enunciado:
      'provedor recusou, explodiu ou não respondeu ⟹ a operação não alcança `verificada` ' +
      'e o turno não pode afirmar conclusão',
    briefing: 'FAILED_TOOL → NEVER REPORT SUCCESS',
    imposta_por: [
      { arquivo: `${K}/PortalEfeitos.ts`, simbolo: 'executar' },
      { arquivo: `${K}/Operacao.ts`, simbolo: 'EvidenciaInsuficiente' },
    ],
    violacao_permitiria: 'a IARA dizer "enviei" sobre uma mensagem que o provedor recusou',
  },
  {
    id: 'P3_ACAO_CANCELADA_NUNCA_EXECUTA',
    enunciado:
      'operação em `cancelada` ⟹ nenhuma transição posterior existe, inclusive a que viria ' +
      'de um "confirmo" atrasado',
    briefing: 'CANCELLED_ACTION → NEVER EXECUTE',
    imposta_por: [
      { arquivo: `${K}/Operacao.ts`, simbolo: 'TRANSICOES' },
      { arquivo: `${K}/RegistroOperacoes.ts`, simbolo: 'autorizar' },
    ],
    violacao_permitiria:
      'o operador desistir de desligar uma máquina e ela desligar assim mesmo, por um "confirmo" em voo',
  },
  {
    id: 'P4_SHARD_ALHEIO_NUNCA_E_ALCANCADO',
    enunciado:
      'linha de jornal cujo dono difere do dono do arquivo ⟹ recusada, nunca indexada; ' +
      'e identificador não canônico ⟹ recusado, nunca saneado',
    briefing: 'USER_A → NEVER ACCESS USER_B_DATA',
    imposta_por: [
      { arquivo: `${K}/RegistroOperacoes.ts`, simbolo: 'lerLinhaDoJornal' },
      { arquivo: `${K}/Identidade.ts`, simbolo: 'exigirIdCanonico' },
    ],
    violacao_permitiria:
      'a pendência de uma pessoa aparecer como pendência de outra depois de um restart',
  },
  {
    id: 'P5_DONO_DO_EFEITO_NUNCA_VEM_DO_PEDIDO',
    enunciado:
      'parâmetro do pedido que se pareça com identidade (`id_usuario`, `shard`, `dono`) ⟹ ' +
      'ignorado ou recusado; o dono do efeito é o da sessão verificada',
    briefing: 'TENANT_A → NEVER ACCESS TENANT_B_DATA (aqui: operador ≡ locatário)',
    imposta_por: [
      { arquivo: `${K}/Operacao.ts`, simbolo: 'criarOperacao' },
      { arquivo: `${K}/Habilidade.ts`, simbolo: 'validar' },
    ],
    violacao_permitiria:
      'a LLM emitir um parâmetro com o id de outra pessoa e o efeito nascer no shard dela',
  },
  {
    id: 'P6_FATO_DESCONHECIDO_NUNCA_VIRA_VERIFICADO',
    enunciado:
      'evidência de fonte diferente de `verificador`, ou invariante não conferida, ou chave de ' +
      'prova ausente ⟹ o veredito é `desconhecida`/`sem_chave`, nunca `verificada`/`valido`',
    briefing: 'UNKNOWN_FACT → NEVER MARK VERIFIED',
    imposta_por: [
      { arquivo: `${K}/Operacao.ts`, simbolo: 'transicionar' },
      { arquivo: `${K}/Prova.ts`, simbolo: 'emitirProva' },
      { arquivo: `${K}/Prova.ts`, simbolo: 'conferirRegistro' },
    ],
    violacao_permitiria:
      'uma trilha de auditoria dizer "conferido" sobre um efeito que ninguém conferiu',
  },
  {
    id: 'P7_PLANO_EMERGENTE_NUNCA_EXECUTA_RISCO_ALTO',
    enunciado:
      'passo de risco alto proposto pela camada de raciocínio ⟹ recusado; e o manifesto ' +
      'de risco alto nem entra no catálogo oferecido à LLM',
    briefing: 'UNVERIFIED_PLAN → NEVER EXECUTE HIGH_RISK_ACTION',
    imposta_por: [{ arquivo: `${K}/PorteiroAutorizacao.ts`, simbolo: 'planejavel' }],
    violacao_permitiria: 'a LLM montar sozinha um plano que desliga a máquina ou envia a terceiro',
  },
  {
    id: 'P8_ACAO_IRREVERSIVEL_EXIGE_FALA_HUMANA',
    enunciado:
      'operação de risco alto ⟹ só chega a `autorizada` com evidência carimbada `operador`; ' +
      'porteiro, executor, relógio e reidratação não bastam',
    briefing: 'DESTRUCTIVE_ACTION → NEVER EXECUTE WITHOUT REQUIRED APPROVAL',
    imposta_por: [
      { arquivo: `${K}/Operacao.ts`, simbolo: 'transicionar' },
      { arquivo: `${K}/PoliticaRisco.ts`, simbolo: 'exigenciaDe' },
    ],
    violacao_permitiria:
      'um efeito irreversível autorizado por um componente do próprio sistema, sem ninguém ter falado',
  },
];

export function propriedade(id: IdPropriedade): PropriedadeCritica {
  const p = PROPRIEDADES_CRITICAS.find((x) => x.id === id);
  if (!p) throw new Error(`propriedade crítica não declarada: ${id}`);
  return p;
}
