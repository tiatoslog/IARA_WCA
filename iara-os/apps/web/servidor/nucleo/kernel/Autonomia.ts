/**
 * AUTONOMIA — até onde a IARA pode ir sem perguntar.
 *
 * A REGRA QUE GOVERNA O ARQUIVO INTEIRO, e sem a qual ele seria perigoso:
 *
 *   **autonomia é um TETO, nunca uma concessão.**
 *
 * Subir o nível não autoriza nada. Ele só remove um impedimento que existia
 * ACIMA das travas — todas elas continuam no caminho, na mesma ordem: o
 * `PorteiroAutorizacao` continua exigindo plano determinístico para risco alto,
 * o `SandboxPorPolitica` continua conferindo o papel, o esquema continua
 * validando, e a confirmação de energia continua sendo pedida. No nível máximo,
 * um plano emitido pela LLM continua sem conseguir desligar a máquina.
 *
 * Dito de outro jeito: baixar a autonomia PODE impedir uma ação que as travas
 * permitiriam; subir a autonomia NUNCA permite uma ação que as travas impedem.
 * Há teste travando exatamente isso, porque é a única propriedade deste módulo
 * que, se quebrar, quebra o resto do kernel junto.
 *
 * SOBRE A ORDEM DA ESCADA, e por que ela difere da especificação. O documento
 * de evolução lista `3 = sugerir ações` DEPOIS de `2 = executar planos
 * aprovados` — o que colocaria "falar sem ser chamada" acima de "agir". Não é
 * uma escada: são duas capacidades diferentes, e uma delas é claramente menos
 * invasiva que a outra. Aqui elas ficam ordenadas por QUANTO A IARA PODE FAZER
 * SEM SER PERGUNTADA, que é a única ordenação que faz um teto significar
 * alguma coisa. A intenção da lista original está preservada inteira; só a
 * numeração mudou, e mudou para poder ser comparada com `>=`.
 */

/**
 * A escada, do mais contido ao mais solto. A posição no array É o nível.
 */
export const ESCADA = [
  /** Só conversa. Nenhuma habilidade roda, nem a que o operador pediu. */
  'conversa',
  /** Executa o que foi pedido explicitamente, neste turno. O mínimo útil. */
  'comando',
  /** Executa também os planos que o operador aprovou. É o padrão. */
  'plano',
  /** Pode FALAR sem ser chamada: avisar, alertar, sugerir. Continua sem agir. */
  'sugestao',
  /** Executa ações previamente autorizadas sem perguntar de novo. */
  'rotina',
] as const;

export type NivelAutonomia = (typeof ESCADA)[number];

/**
 * O PADRÃO É `plano`, e a escolha não é neutra: é exatamente o comportamento que
 * a IARA já tinha antes de este arquivo existir. Um padrão mais alto faria a
 * instalação de alguém mudar de comportamento por causa de um deploy; um mais
 * baixo quebraria o que já funciona. Mudança de autonomia tem que ser um ato do
 * operador, nunca um efeito colateral de atualizar.
 */
export const NIVEL_PADRAO: NivelAutonomia = 'plano';

function posicao(n: NivelAutonomia): number {
  return ESCADA.indexOf(n);
}

/**
 * O que se quer fazer, no vocabulário do domínio — e não "qual nível preciso?".
 *
 * A pergunta é sempre `podeSem(nivel, 'falar_sem_ser_chamada')`, nunca
 * `nivel >= 3`. Comparar números espalha a escada pelo código: no dia em que um
 * degrau novo entrar no meio, todos os `>= 3` do sistema passam a significar
 * outra coisa, em silêncio.
 */
export type CapacidadeAutonoma =
  /** Rodar uma habilidade que o operador pediu neste turno. */
  | 'executar_pedido'
  /** Rodar os passos de um plano que o operador aprovou. */
  | 'executar_plano_aprovado'
  /** Iniciar fala: alertar sobre algo que ninguém perguntou. */
  | 'falar_sem_ser_chamada'
  /** Agir sobre algo que ninguém pediu neste turno. */
  | 'agir_sem_perguntar';

const EXIGE: Record<CapacidadeAutonoma, NivelAutonomia> = {
  executar_pedido: 'comando',
  executar_plano_aprovado: 'plano',
  falar_sem_ser_chamada: 'sugestao',
  agir_sem_perguntar: 'rotina',
};

/** O nível permite esta capacidade? */
export function podeSem(nivel: NivelAutonomia, capacidade: CapacidadeAutonoma): boolean {
  return posicao(nivel) >= posicao(EXIGE[capacidade]);
}

/**
 * A frase que explica a recusa ao operador.
 *
 * Existe porque "não posso fazer isso" é a pior recusa possível: ela não diz o
 * que mudar. Aqui a pessoa fica sabendo qual degrau falta e que a decisão é
 * dela — que é a diferença entre um sistema contido e um sistema quebrado.
 */
export function motivoDaRecusa(nivel: NivelAutonomia, capacidade: CapacidadeAutonoma): string {
  const exigido = EXIGE[capacidade];
  const oQue: Record<CapacidadeAutonoma, string> = {
    executar_pedido: 'executar ações',
    executar_plano_aprovado: 'executar planos aprovados',
    falar_sem_ser_chamada: 'te avisar de coisas sem você perguntar',
    agir_sem_perguntar: 'agir sozinha em situações que você já autorizou antes',
  };
  return (
    `Minha autonomia está em "${nivel}", e ${oQue[capacidade]} exige "${exigido}". ` +
    `Não vou subir isso por conta própria — a decisão é sua.`
  );
}

const VARIAVEL = 'IARA_AUTONOMIA';

export function ehNivel(v: unknown): v is NivelAutonomia {
  return typeof v === 'string' && (ESCADA as readonly string[]).includes(v);
}

/**
 * O nível configurado, lido a cada chamada.
 *
 * NÃO É CACHEADO de propósito: um valor lido uma vez na partida transformaria
 * "mudei a autonomia" em "reinicie o motor", e — pior — deixaria um teste que
 * mexe na variável contaminar o seguinte, o que esconde exatamente o tipo de
 * defeito que este módulo não pode ter.
 *
 * Valor inválido cai no padrão E RECLAMA. Cair calado no padrão seria aceitável
 * se o padrão fosse o mais contido; como ele não é o mais contido, um erro de
 * digitação em `IARA_AUTONOMIA=conversa` deixaria a IARA mais solta do que o
 * operador quis, sem ninguém saber.
 */
export function nivelAtual(): NivelAutonomia {
  const bruto = process.env[VARIAVEL]?.trim();
  if (!bruto) return NIVEL_PADRAO;
  if (ehNivel(bruto)) return bruto;
  console.warn(
    `[iara] ${VARIAVEL}="${bruto}" não é um nível conhecido (${ESCADA.join(', ')}); ` +
      `usando "${NIVEL_PADRAO}".`,
  );
  return NIVEL_PADRAO;
}
