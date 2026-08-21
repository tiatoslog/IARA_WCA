/**
 * Normalização de texto. Utilitário puro, sem opinião sobre intenção.
 *
 * Morava dentro do `RoteadorIntencoes`, e quatro módulos que nada têm a ver com
 * roteamento importavam de lá (`RagHistorico`, `TeoriaDaMente`, `Percepcao`,
 * `dados`). Importar de um módulo de decisão o que é só uma função de string
 * cria dependência falsa — e foi parte do que manteve viva uma camada de
 * roteamento que já não decidia nada.
 */

/**
 * Remove acento, uniformiza caixa e colapsa espaço.
 *
 * SEM isto, `/ja aconteceu/` nunca casa com "já aconteceu" — o bug silencioso
 * mais comum em reconhecedor PT-BR.
 *
 * A faixa de marcas combinantes vai na forma ESCAPADA, não literal: a forma
 * literal depende de a codificação do arquivo sobreviver a todo editor que um
 * dia tocar nele.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * S\u00f3 a primeira letra. O nome do operador chega em caixa baixa por vir do
 * e-mail de login (`daiane`), e devolver isso cru no prompt faz a IARA
 * escrever "Terceira vez, daiane" \u2014 achado ao vivo em auditoria (14/08/2026).
 * A mesma regra j\u00e1 existia no lado do cliente (`PainelConversa.tsx`, para a
 * sauda\u00e7\u00e3o do cabe\u00e7alho); faltava aqui, onde o nome entra no prompt de quem
 * responde. `de`, `da`, `dos` de sobrenome n\u00e3o s\u00e3o nomes pr\u00f3prios \u2014 capitalizar
 * s\u00f3 a primeira letra evita "Da Silva" onde deveria ficar "da Silva".
 */
export function capitalizarNome(nome: string): string {
  return nome ? nome.charAt(0).toLocaleUpperCase('pt-BR') + nome.slice(1) : nome;
}

/**
 * Concord\u00e2ncia de n\u00famero. Existe para matar o `(s)`.
 *
 * `"3 central(is) ativa(s)"` e `"2 lembrete(s)"` s\u00e3o a voz de formul\u00e1rio de
 * reparti\u00e7\u00e3o, e apareciam na resposta mais frequente da opera\u00e7\u00e3o \u2014 quantas
 * centrais temos. Nenhuma pessoa escreve assim para outra; escreve-se assim
 * quando n\u00e3o se sabe o n\u00famero na hora de redigir. Aqui se sabe: o n\u00famero est\u00e1
 * no argumento.
 *
 * O plural \u00e9 EXPL\u00cdCITO, e \u00e9 a \u00fanica decis\u00e3o de projeto que este utilit\u00e1rio
 * toma. Derivar plural de portugu\u00eas por regra (`+s`, `-l` \u2192 `-is`, `-\u00e3o` \u2192
 * `-\u00f5es`) acerta a maioria e erra em sil\u00eancio o resto, e um utilit\u00e1rio de
 * reda\u00e7\u00e3o que erra em sil\u00eancio produz exatamente o constrangimento que ele
 * veio evitar. Duas strings custam nada e nunca erram.
 */
export function concordar(quantidade: number, singular: string, plural: string): string {
  return Math.abs(quantidade) === 1 ? singular : plural;
}

/** O mesmo, j\u00e1 com o n\u00famero na frente: `contar(3, 'central', 'centrais')`. */
export function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${concordar(quantidade, singular, plural)}`;
}

/**
 * Palavras de que as \u00e2ncoras do `Percepcao` dependem para reconhecer inten\u00e7\u00e3o
 * \u2014 n\u00e3o \u00e9 dicion\u00e1rio geral, \u00e9 s\u00f3 o vocabul\u00e1rio de gatilho. Pedido expl\u00edcito
 * de auditoria (14/08/2026): erro de digita\u00e7\u00e3o n\u00e3o pode derrubar o
 * reconhecimento determin\u00edstico e empurrar tudo pro racioc\u00ednio emergente
 * sem necessidade.
 *
 * S\u00d3 SUBSTANTIVO DE FORMA FIXA \u2014 nenhum verbo. Achado ao vivo na pr\u00f3pria
 * auditoria: "desliga" (forma v\u00e1lida, "ele desliga o computador") est\u00e1 a uma
 * letra de "desligar" e virava "desligar" por engano, mudando o tempo verbal
 * e quebrando a distin\u00e7\u00e3o entre pergunta hipot\u00e9tica e ordem. Verbo n\u00e3o entra
 * aqui porque j\u00e1 n\u00e3o precisa: as \u00e2ncoras que dependem de verbo (`desligue|
 * desliga|desligar|...`, `cancel\w*`, `pesquis\w*`, `confirmo|confirma|...`)
 * j\u00e1 enumeram a conjuga\u00e7\u00e3o ou usam prefixo \u2014 a toler\u00e2ncia a erro de dedo j\u00e1
 * existe onde existe verbo. Substantivo n\u00e3o tem essa rede.
 */
const PALAVRAS_ANCORA = [
  'clima', 'tempo', 'temperatura', 'previsao', 'chuva',
  'lembrete', 'lembretes', 'agenda',
  'pasta', 'aplicativo', 'arquivo', 'arquivos', 'tela', 'sistema', 'computador',
  'central', 'centrais', 'frota', 'incidente', 'erro', 'noticia', 'noticias',
];

/**
 * Dist\u00e2ncia de edi\u00e7\u00e3o de no m\u00e1ximo 1 \u2014 inser\u00e7\u00e3o, remo\u00e7\u00e3o ou troca de UMA
 * letra. Basta para o erro de digita\u00e7\u00e3o comum ("lembrte", "chuvva",
 * "aconteceo"); qualquer coisa al\u00e9m disso j\u00e1 \u00e9 palavra diferente, n\u00e3o erro de
 * dedo, e corrigir "al\u00e9m disso" \u00e9 quando o corretor come\u00e7a a inventar.
 */
function distanciaAteUm(a: string, b: string): boolean {
  if (a === b) return false;
  const dif = a.length - b.length;
  if (dif < -1 || dif > 1) return false;

  if (dif === 0) {
    // Mesmo comprimento: no m\u00e1ximo uma posi\u00e7\u00e3o pode diferir (troca de letra).
    let trocas = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i] && ++trocas > 1) return false;
    }
    return trocas === 1;
  }

  // Comprimentos vizinhos: a mais curta precisa ser subsequ\u00eancia da mais
  // longa saltando exatamente UMA letra (a letra inserida ou removida).
  const curta = dif > 0 ? b : a;
  const longa = dif > 0 ? a : b;
  let i = 0;
  let j = 0;
  let pulou = false;
  while (i < curta.length && j < longa.length) {
    if (curta[i] === longa[j]) {
      i += 1;
      j += 1;
    } else if (!pulou) {
      pulou = true;
      j += 1;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Corrige erro de digita\u00e7\u00e3o de UMA letra nas palavras que as \u00e2ncoras
 * reconhecem \u2014 e s\u00f3 nelas. Roda DEPOIS de `normalizar` (j\u00e1 sem acento, j\u00e1
 * min\u00fasculo), e s\u00f3 sobre o texto usado para RECONHECER inten\u00e7\u00e3o: quem chama
 * isto nunca deve usar o resultado para extrair o que o operador realmente
 * escreveu (assunto de lembrete, nome de pasta) \u2014 isso continua vindo do
 * texto original, sem corre\u00e7\u00e3o nenhuma.
 *
 * Amb\u00edguo n\u00e3o corrige: se o token estiver a uma letra de dist\u00e2ncia de MAIS
 * de uma palavra da lista, fica como est\u00e1. Corrigir errado \u00e9 pior que n\u00e3o
 * reconhecer a \u00e2ncora \u2014 vira o mesmo defeito de "tema n\u00e3o \u00e9 pergunta", s\u00f3
 * que fabricado por esta fun\u00e7\u00e3o em vez de evitado por ela.
 */
export function corrigirTypos(textoNormalizado: string): string {
  return textoNormalizado
    .split(/(\s+)/)
    .map((token) => {
      if (token.length < 4 || PALAVRAS_ANCORA.includes(token)) return token;
      const candidatas = PALAVRAS_ANCORA.filter((p) => distanciaAteUm(token, p));
      return candidatas.length === 1 ? candidatas[0] : token;
    })
    .join('');
}

/**
 * A FRASE PERGUNTA, ou manda?
 *
 * SINTAXE, NUNCA VOCABULÁRIO DE DOMÍNIO — e é essa restrição que faz esta
 * função valer alguma coisa. Ela não sabe o que é lembrete, pasta ou carga, e
 * não pode saber: no instante em que alguém acrescentar um substantivo aqui,
 * ela vira mais uma lista de frases, que é exatamente a doença que ela existe
 * para tratar. O sinal é o ponto de interrogação e o pronome interrogativo em
 * abertura — dois traços que valem para qualquer pergunta em português,
 * inclusive as de habilidades que ainda não nasceram.
 *
 * O DEFEITO QUE ISTO FECHA (auditoria de 21/08/2026). Duas âncoras de receita
 * determinística compilavam PERGUNTA em ESCRITA NÃO IDEMPOTENTE:
 *
 *   « esse lembrete das 11h foi criado quando? »
 *     → agendar_lembrete({ assunto: "das foi criado quando", quando: "hoje às 11:00" })
 *   « a captura de tela funciona? »
 *     → capturar_tela({ local: "documentos" })
 *
 * Nos dois, a rota era `plano_local`: sem laço, sem LLM no caminho e — porque
 * o risco declarado é `medio` — sem porteiro. Nada na cadeia podia ler a frase
 * de novo. O operador perguntava e a agenda dele ganhava um item.
 *
 * A CAUSA não era a regex de nenhuma das duas âncoras. Era a FORMA das
 * receitas: cancelar e listar são casos casados, e CRIAR é o que sobra no
 * `return` final. Alargar a regex de listagem — que foi a correção de
 * 14/08/2026 para o mesmo defeito, documentada em `Planejador.ts` — conserta a
 * frase e deixa a forma intacta, então o defeito volta pela frase seguinte.
 *
 * `como` fica de fora de propósito: "como está o computador?" traz o "?" e é
 * pega por ele, enquanto "como pedido, cria a pasta" não é pergunta nenhuma.
 * `que` sozinho também fica: "que bom", "que pena". Subcontar pergunta é o
 * lado certo de errar aqui — o falso NEGATIVO devolve o comportamento de hoje,
 * e o falso POSITIVO só troca a receita determinística pelo laço, que responde
 * a mesma coisa com catálogo e porteiro na frente.
 */
const ABERTURA_INTERROGATIVA =
  /^(o que|quando|quanto|quantos|quantas|qual|quais|onde|quem|por que|porque|cade|sera que)\b/;

export function ehInterrogativa(bruto: string): boolean {
  if (/\?\s*$/.test(bruto.trim())) return true;
  return ABERTURA_INTERROGATIVA.test(normalizar(bruto));
}
