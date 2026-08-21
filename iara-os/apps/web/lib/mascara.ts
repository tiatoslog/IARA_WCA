/**
 * Máscara de dado sensível — a camada que roda ANTES de qualquer texto sair da
 * máquina do operador.
 *
 * A REGRA QUE ELA CUMPRE está no §13 do pedido e no §15 da arquitetura: o
 * mascaramento acontece NA ORIGEM. Não é o motor que recebe CPF e apaga depois —
 * o CPF nunca atravessa a rede. Mascarar no servidor seria uma política escrita
 * do lado errado do cabo: bastaria um log, um erro serializado ou um proxy no
 * caminho para o dado já ter vazado antes de a política rodar.
 *
 * POR QUE ESTE ARQUIVO ESTÁ EM `lib/`: o Braço precisa dele. `lib/` é o contrato
 * compartilhado, e é o único lugar de onde o processo que roda na máquina da
 * pessoa pode importar sem furar a fronteira.
 *
 * A DECISÃO DE PROJETO QUE MERECE DEFESA: mascarar com um RÓTULO, não com `n`.
 *
 * A fila de lacunas (`assinaturaDeLacuna`) troca todo dígito por `n`, e ali está
 * certo — o que importa lá é a forma da pergunta. Aqui a máscara alimenta a
 * IARA num contexto operacional, e a diferença entre *«a tela mostra um CPF»* e
 * *«a tela mostra um valor»* é a diferença entre um diagnóstico útil e um
 * diagnóstico cego. O rótulo preserva o TIPO e destrói o CONTEÚDO, que é
 * exatamente a troca que se quer.
 *
 * O QUE ELA NÃO É: anonimização. Um nome próprio na tela sobrevive à máscara —
 * não existe regex para nome. O que protege isso é a partição por operador e o
 * fato de nenhuma tela ser armazenada; a máscara cobre o que TEM forma
 * reconhecível, e este comentário existe para ninguém confundir as duas coisas.
 */

/** O que foi encontrado e escondido. Nomes em português, como o domínio. */
export type TipoSensivel =
  | 'cpf'
  | 'cnpj'
  | 'chave_fiscal'
  | 'placa'
  | 'cep'
  | 'telefone'
  | 'email'
  | 'valor'
  | 'numero';

/** O rótulo que substitui o dado. Visível, para quem lê saber que houve máscara. */
export function rotulo(tipo: TipoSensivel): string {
  return `«${tipo}»`;
}

interface Regra {
  readonly tipo: TipoSensivel;
  readonly re: RegExp;
}

/**
 * A ORDEM É A REGRA, e ela vai do mais específico ao mais genérico.
 *
 * Cada linha aqui existe porque, sem ela, o padrão de baixo comeria o de cima e
 * o rótulo sairia errado. `numero` é o último de propósito: ele é a rede de
 * segurança para documento que este arquivo não previu, e posto antes comeria
 * CPF, CNPJ e chave fiscal — todos são "muitos dígitos".
 *
 * NENHUMA REGRA VALIDA O DADO. Não há dígito verificador conferido, e é
 * deliberado: mascarar um CPF inválido não custa nada; deixar passar um válido
 * porque a conta não fechou custa o vazamento que este arquivo existe para
 * impedir. Falso positivo aqui é barato, falso negativo não é.
 */
const REGRAS: readonly Regra[] = [
  { tipo: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  /** Chave de acesso de NF-e/CT-e/MDF-e: 44 dígitos, com ou sem espaço. */
  { tipo: 'chave_fiscal', re: /\b\d{4}[\s.]?(?:\d{4}[\s.]?){10}\b/g },
  { tipo: 'cnpj', re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g },
  { tipo: 'cpf', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  /** Mercosul (ABC1D23) e o formato antigo (ABC-1234). */
  { tipo: 'placa', re: /\b[A-Za-z]{3}-?\d[A-Za-z\d]\d{2}\b/g },
  { tipo: 'cep', re: /\b\d{5}-\d{3}\b/g },
  {
    tipo: 'telefone',
    re: /(?:\+55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,
  },
  /** `R$ 1.234,56` e `1.234,56` — o separador decimal por vírgula é a marca. */
  { tipo: 'valor', re: /(?:R\$\s?)?\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g },
  /**
   * A REDE DE SEGURANÇA: qualquer corrida de 6+ dígitos. Número de OCI, de
   * CT-e, de manifesto, de pedido — tudo que a operação usa como identificador e
   * que este arquivo não tem como enumerar.
   *
   * Seis, e não quatro: um "erro 1145" precisa sobreviver, porque é ele que a
   * IARA usa para procurar orientação no POP. Código de erro não é dado pessoal,
   * e mascará-lo destruiria a única informação acionável da tela.
   */
  { tipo: 'numero', re: /\b\d{6,}\b/g },
];

export interface TextoMascarado {
  readonly texto: string;
  /** Os tipos encontrados, sem repetição e em ordem estável. */
  readonly encontrados: readonly TipoSensivel[];
}

/**
 * Esconde o que tem forma de dado sensível e diz o que escondeu.
 *
 * Devolver os TIPOS junto é o que permite ao motor dizer *"a tela mostra um CPF
 * e um valor"* sem nunca ter recebido nenhum dos dois — e é o que permite a um
 * teste afirmar que a máscara agiu, em vez de afirmar que a saída não contém uma
 * string específica.
 */
export function mascarar(bruto: string): TextoMascarado {
  const encontrados: TipoSensivel[] = [];
  let texto = bruto;
  for (const regra of REGRAS) {
    /* `lastIndex` zerado a cada uso: estes regexes são `g` e módulo-nível, e um
       `lastIndex` herdado da chamada anterior faz o SEGUNDO texto pular o
       começo. É o defeito clássico de regex global compartilhada, e aqui ele
       significaria um CPF não mascarado. */
    regra.re.lastIndex = 0;
    if (!regra.re.test(texto)) continue;
    regra.re.lastIndex = 0;
    texto = texto.replace(regra.re, rotulo(regra.tipo));
    encontrados.push(regra.tipo);
  }
  return { texto, encontrados };
}

/** Havia algo com forma de dado sensível? Útil para teste e para auditoria. */
export function temSensivel(bruto: string): boolean {
  return mascarar(bruto).encontrados.length > 0;
}

/**
 * Teto de uma linha de texto observado.
 *
 * Uma tela cheia produz centenas de linhas; mandar todas transformaria o evento
 * num despejo do conteúdo da tela, que é o que a arquitetura recusa mesmo
 * mascarado. Linha longa é quase sempre parágrafo de conteúdo, não rótulo de
 * campo nem mensagem de erro.
 */
export const MAX_LINHA = 120;

/** Teto de linhas por evento. Ver `MAX_LINHA`. */
export const MAX_LINHAS = 12;

/**
 * O texto de uma tela, pronto para virar evento: mascarado, cortado e limitado.
 *
 * A PODA VEM DEPOIS DA MÁSCARA, nunca antes: cortar primeiro poderia partir um
 * CPF ao meio e deixar metade dele passar por não casar mais o padrão.
 */
export function prepararTextoDaTela(linhas: readonly string[]): TextoMascarado {
  const encontrados = new Set<TipoSensivel>();
  const saida: string[] = [];
  for (const linha of linhas) {
    const limpa = linha.replace(/\s+/g, ' ').trim();
    if (!limpa) continue;
    const m = mascarar(limpa);
    for (const t of m.encontrados) encontrados.add(t);
    saida.push(m.texto.slice(0, MAX_LINHA));
    if (saida.length >= MAX_LINHAS) break;
  }
  return { texto: saida.join('\n'), encontrados: [...encontrados] };
}

/**
 * MENSAGEM DE SISTEMA — o que a percepção pode NOMEAR sem interpretar.
 *
 * Reconhece a FORMA de um aviso ("erro", "falha", "não foi possível"), nunca o
 * significado dele. Quem decide se aquilo é problema, e o que fazer, é o
 * diagnóstico do treinamento, contra o POP — a percepção só entrega a frase.
 *
 * É por isso que o evento se chama `mensagem_detectada` e não `erro_detectado`:
 * a IARA observou uma mensagem; afirmar que houve erro seria interpretar pixel.
 */
export const FORMA_DE_MENSAGEM =
  /\b(erro|falha|inv[áa]lid[oa]|n[ãa]o\s+foi\s+poss[íi]vel|n[ãa]o\s+permitid[oa]|negad[oa]|recusad[oa]|obrigat[óo]ri[oa]|aten[çc][ãa]o|advert[êe]ncia|expirad[oa]|sem\s+permiss[ãa]o|timeout)\b/i;

/** As linhas que TÊM FORMA de mensagem de sistema. Já mascaradas pelo chamador. */
export function linhasDeMensagem(linhas: readonly string[]): readonly string[] {
  return linhas.filter((l) => FORMA_DE_MENSAGEM.test(l)).slice(0, 3);
}
