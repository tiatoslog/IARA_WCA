/**
 * FabricaRaciocinio — a matriz de seleção do provedor.
 *
 * A propriedade central: infraestrutura é DECLARADA, nunca descoberta. Sem
 * `OLLAMA_URL` no ambiente, nenhum caminho leva ao provedor local — nem numa
 * máquina que tenha um Ollama rodando na porta padrão. É o que mantém estes
 * testes determinísticos em qualquer computador.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { criarProvedorRaciocinio, provedoresDeclarados } from '../servidor/nucleo/FabricaRaciocinio';
import { ClienteClaude } from '../servidor/nucleo/ClienteClaude';
import { ClienteOllama } from '../servidor/nucleo/ClienteOllama';
import { CadeiaDeRaciocinio } from '../servidor/nucleo/CadeiaDeRaciocinio';
import { ClienteCompativelOpenAI } from '../servidor/nucleo/ClienteCompativelOpenAI';
import { ConfiguracaoInvalida } from '../servidor/nucleo/kernel/Configuracao';

const CHAVE_VALIDA = `sk-ant-${'a'.repeat(40)}`;
/* Formatos das camadas gratuitas: a Groq prefixa `gsk_`; o Google não usa
   prefixo fixo, só comprimento. */
const CHAVE_GROQ = `gsk_${'b'.repeat(40)}`;
const CHAVE_GEMINI = 'A'.repeat(39);
const CHAVE_OPENROUTER = `sk-or-v1-${'c'.repeat(40)}`;

async function comProcessEnv<T>(
  vars: Record<string, string | undefined>,
  corpo: () => T,
): Promise<T> {
  const anteriores = new Map<string, string | undefined>();
  for (const [nome, valor] of Object.entries(vars)) {
    anteriores.set(nome, process.env[nome]);
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
  try {
    return corpo();
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
}

test('UN-030. chave Anthropic utilizável em auto: ClienteClaude', () => {
  const provedor = criarProvedorRaciocinio({ ANTHROPIC_API_KEY: CHAVE_VALIDA });
  assert.ok(provedor instanceof ClienteClaude);
  assert.equal(provedor.origem, 'nuvem');
});

test('UN-031. sem chave, com OLLAMA_URL declarada: ClienteOllama', async () => {
  await comProcessEnv({ ANTHROPIC_API_KEY: undefined }, () => {
    const provedor = criarProvedorRaciocinio({ OLLAMA_URL: 'http://127.0.0.1:11434' });
    assert.ok(provedor instanceof ClienteOllama);
    assert.equal(provedor.origem, 'local');
  });
});

test('UN-032. sem nada: ClienteClaude indisponível — o modo honesto de sempre', async () => {
  await comProcessEnv({ ANTHROPIC_API_KEY: undefined, OLLAMA_URL: undefined }, () => {
    const provedor = criarProvedorRaciocinio({});
    assert.ok(provedor instanceof ClienteClaude);
    assert.equal(provedor.disponivel, false);
  });
});

test('UN-033. IARA_PROVEDOR forçado vence o auto, nos dois sentidos', async () => {
  await comProcessEnv({ ANTHROPIC_API_KEY: undefined }, () => {
    const forcadoOllama = criarProvedorRaciocinio({
      IARA_PROVEDOR: 'ollama',
      ANTHROPIC_API_KEY: CHAVE_VALIDA, // chave presente e mesmo assim: Ollama
    });
    assert.ok(forcadoOllama instanceof ClienteOllama);

    const forcadoAnthropic = criarProvedorRaciocinio({
      IARA_PROVEDOR: 'anthropic',
      OLLAMA_URL: 'http://127.0.0.1:11434', // URL presente e mesmo assim: nuvem
    });
    assert.ok(forcadoAnthropic instanceof ClienteClaude);
  });
});

test('UN-034. IARA_PROVEDOR=ollama sem OLLAMA_URL usa o padrão local e o modelo padrão', async () => {
  await comProcessEnv({ OLLAMA_URL: undefined, OLLAMA_MODELO: undefined }, () => {
    const provedor = criarProvedorRaciocinio({ IARA_PROVEDOR: 'ollama' });
    assert.ok(provedor instanceof ClienteOllama);
    assert.equal(provedor.modelo, 'llama3.1');
  });
});

test('valor desconhecido de IARA_PROVEDOR é tratado como auto, não como erro', () => {
  const provedor = criarProvedorRaciocinio({
    IARA_PROVEDOR: 'gpt5', // não existe — ausência de valor válido é ausência
    ANTHROPIC_API_KEY: CHAVE_VALIDA,
  });
  assert.ok(provedor instanceof ClienteClaude);
});

test('chave contaminada sem Ollama declarado continua LEVANTANDO — a fábrica não engole', async () => {
  /**
   * O incidente de 13/08 em miniatura: um `\n` e um segundo segredo no meio do
   * valor. `configUtilizavel` responde false, o auto cai para o ClienteClaude
   * padrão, e o construtor DELE levanta `ConfiguracaoInvalida` — exatamente o
   * comportamento de antes da fábrica existir. Um provedor local não pode
   * virar tapete para varrer credencial quebrada para baixo.
   */
  await comProcessEnv(
    {
      ANTHROPIC_API_KEY: `${CHAVE_VALIDA}\nOUTRA_COISA=vazada`,
      OLLAMA_URL: undefined,
      IARA_PROVEDOR: undefined,
    },
    () => {
      assert.throws(() => criarProvedorRaciocinio(), ConfiguracaoInvalida);
    },
  );
});

// ---------------------------------------------------------------------------
// A CADEIA (15/08/2026) — depois de a cota da Anthropic acabar e a IARA ficar
// muda, `auto` deixou de escolher UM provedor e passou a encadear os
// declarados. Um provedor sozinho continua sendo ele mesmo, sem embrulho.
// ---------------------------------------------------------------------------

/**
 * A ORDEM VIROU EM 18/08/2026: a paga desceu para depois das gratuitas. Este
 * teste é o que trava a decisão — sem ele, alguém "arruma" a lista de volta
 * para a ordem antiga achando que corrige um descuido, e a conta volta a subir
 * em silêncio.
 */
test('UN-211. auto com Groq + Anthropic: a GRATUITA vem primeiro, a paga depois', async () => {
  await comProcessEnv(
    { ANTHROPIC_API_KEY: CHAVE_VALIDA, GROQ_API_KEY: CHAVE_GROQ, IARA_PROVEDOR: undefined },
    () => {
      const provedor = criarProvedorRaciocinio({
        ANTHROPIC_API_KEY: CHAVE_VALIDA,
        GROQ_API_KEY: CHAVE_GROQ,
      });
      assert.ok(provedor instanceof CadeiaDeRaciocinio);
      /* O primeiro elo responde pelo retrato enquanto ninguém falhou — e é
         justamente por isso que ele serve de asserção da ordem. */
      assert.equal(provedor.modelo, 'openai/gpt-oss-120b');
      assert.equal(provedor.disponivel, true);
    },
  );
});

/**
 * A ORDEM ENTRE AS GRATUITAS ESTÁ EM ABERTO, e o teste trava o que É hoje — não
 * o que deveria ser.
 *
 * A justificativa original desta posição era de tamanho: "um Nemotron de 55B
 * ativos contra os 70B da Groq". Ela caducou em 18/08/2026 junto com o modelo:
 * a Groq descomissionou o `llama-3.3-70b-versatile` e o substituto declarado é
 * `openai/gpt-oss-120b` — 120B totais, mas MoE com ~5,1B ATIVOS. Pelo critério
 * que a própria ordem invoca, o Nemotron (55B ativos) passou à frente.
 *
 * E a medição do mesmo dia aponta para o mesmo lado por outra razão: a camada
 * gratuita da Groq tem teto de 8.000 tokens por minuto e o prompt da IARA custa
 * ~5.000, então ela entrega ~uma chamada a cada 40 s. O OpenRouter aceitou três
 * chamadas de 5.600 tokens em oito segundos sem 429.
 *
 * NÃO REORDENEI AQUI, e a abstenção é deliberada: a campanha CO contra o
 * OpenRouter ainda não produziu rodada limpa (a primeira foi contaminada por
 * sondas concorrentes na mesma chave), e trocar o primeiro elo da cadeia de
 * produção é decisão de operação, com latência medida na mão. Este comentário
 * existe para que a ordem atual seja lida como PENDENTE de revisão, e não como
 * conclusão — que é o estado em que ela de fato está.
 */
test('UN-211d. OpenRouter entra depois das gratuitas melhores e antes da paga', async () => {
  await comProcessEnv({ IARA_PROVEDOR: undefined }, () => {
    /* Sozinho, é ele mesmo — e no modelo `:free`. O sufixo é o que separa o
       gratuito do pago sob o MESMO id; perdê-lo é ganhar fatura em silêncio. */
    const so = criarProvedorRaciocinio({ OPENROUTER_API_KEY: CHAVE_OPENROUTER });
    assert.ok(so instanceof ClienteCompativelOpenAI);
    assert.equal(so.modelo, 'nvidia/nemotron-3-ultra-550b-a55b:free');
    assert.match(so.modelo, /:free$/);

    /* Com a Groq presente, quem responde primeiro é a Groq. */
    const comGroq = criarProvedorRaciocinio({
      GROQ_API_KEY: CHAVE_GROQ,
      OPENROUTER_API_KEY: CHAVE_OPENROUTER,
    });
    assert.ok(comGroq instanceof CadeiaDeRaciocinio);
    assert.equal(comGroq.modelo, 'openai/gpt-oss-120b');

    /* Com a paga presente, o gratuito ainda vem primeiro — é o ponto da troca
       de 18/08: dinheiro só se gasta quando o de graça falhou. */
    const comPaga = criarProvedorRaciocinio({
      OPENROUTER_API_KEY: CHAVE_OPENROUTER,
      ANTHROPIC_API_KEY: CHAVE_VALIDA,
    });
    assert.ok(comPaga instanceof CadeiaDeRaciocinio);
    assert.equal(comPaga.modelo, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  });
});

test('UN-211b. auto com Groq + Gemini (sem Anthropic): cadeia das duas gratuitas', async () => {
  await comProcessEnv(
    {
      ANTHROPIC_API_KEY: undefined,
      GROQ_API_KEY: CHAVE_GROQ,
      GEMINI_API_KEY: CHAVE_GEMINI,
      IARA_PROVEDOR: undefined,
    },
    () => {
      const provedor = criarProvedorRaciocinio({
        GROQ_API_KEY: CHAVE_GROQ,
        GEMINI_API_KEY: CHAVE_GEMINI,
      });
      assert.ok(provedor instanceof CadeiaDeRaciocinio);
      assert.equal(provedor.modelo, 'openai/gpt-oss-120b');
    },
  );
});

test('UN-211c. um provedor só continua sendo ele mesmo, sem cadeia por cima', async () => {
  await comProcessEnv(
    { ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: CHAVE_GEMINI, IARA_PROVEDOR: undefined },
    () => {
      const provedor = criarProvedorRaciocinio({ GEMINI_API_KEY: CHAVE_GEMINI });
      assert.ok(provedor instanceof ClienteCompativelOpenAI);
      assert.equal(provedor.apelido, 'gemini');
    },
  );
});

test('UN-212. IARA_PROVEDOR declarado força UM provedor, sem cadeia', async () => {
  await comProcessEnv({ GROQ_API_KEY: CHAVE_GROQ, GEMINI_API_KEY: CHAVE_GEMINI }, () => {
    const groq = criarProvedorRaciocinio({
      IARA_PROVEDOR: 'groq',
      ANTHROPIC_API_KEY: CHAVE_VALIDA,
      GEMINI_API_KEY: CHAVE_GEMINI,
    });
    assert.ok(groq instanceof ClienteCompativelOpenAI);
    assert.equal(groq.apelido, 'groq');
    assert.ok(!(groq instanceof CadeiaDeRaciocinio));
  });
});

test('UN-213. sem chave nenhuma: nada de cadeia, e o modo honesto continua de pé', async () => {
  await comProcessEnv(
    {
      ANTHROPIC_API_KEY: undefined,
      GROQ_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      OLLAMA_URL: undefined,
    },
    () => {
      const provedor = criarProvedorRaciocinio({});
      assert.ok(provedor instanceof ClienteClaude);
      assert.equal(provedor.disponivel, false);
    },
  );
});

test('provedoresDeclarados: a lista que o /saude mostra, em ordem e sem segredo', async () => {
  await comProcessEnv({ IARA_PROVEDOR: undefined }, () => {
    assert.deepEqual(
      provedoresDeclarados({
        ANTHROPIC_API_KEY: CHAVE_VALIDA,
        GROQ_API_KEY: CHAVE_GROQ,
        GEMINI_API_KEY: CHAVE_GEMINI,
        OPENROUTER_API_KEY: CHAVE_OPENROUTER,
        OLLAMA_URL: 'http://127.0.0.1:11434',
      }),
      /* MESMA ORDEM DA CADEIA. `/saude` mostra quem responde PRIMEIRO; uma lista
         que discorde da fábrica aponta um cérebro enquanto a IARA usa outro. */
      ['groq', 'gemini', 'openrouter', 'anthropic', 'ollama'],
    );

    /* O caso que o endpoint existe para tornar visível: nenhum cérebro
       declarado — a IARA conversa mas não pensa, e de fora isso era
       indistinguível de um deploy saudável. */
    assert.deepEqual(provedoresDeclarados({}), []);

    /* Provedor forçado E utilizável: só ele, como na fábrica. */
    assert.deepEqual(
      provedoresDeclarados({
        IARA_PROVEDOR: 'groq',
        GROQ_API_KEY: CHAVE_GROQ,
        ANTHROPIC_API_KEY: CHAVE_VALIDA,
      }),
      ['groq'],
    );

    /**
     * PROVEDOR FORÇADO E SEM CHAVE: nada. E esta asserção substitui a que estava
     * aqui, que afirmava `['groq']` para EXATAMENTE este ambiente — o teste
     * fixava o defeito.
     *
     * Em 18/08/2026 uma campanha inteira subiu assim: `--cerebro groq` trocava o
     * seletor, a chave continuava zerada pelo `MotorSandbox`, e o banner do motor
     * anunciava "groq" enquanto o Kernel respondia "a camada de raciocínio está
     * desligada" no mesmo processo. Doze segundos de recusa honesta que o
     * relatório teria chamado de resultado da Groq.
     *
     * É o incidente de 15/08 — diagnóstico verde sobre processo sem cérebro —
     * pela porta que ninguém checava. A chave da Anthropic presente no ambiente
     * está aqui de propósito: ela NÃO salva a lista, porque forçar um provedor
     * desliga a cadeia, e é isso que torna o relato vazio a verdade.
     */
    assert.deepEqual(
      provedoresDeclarados({ IARA_PROVEDOR: 'groq', ANTHROPIC_API_KEY: CHAVE_VALIDA }),
      [],
    );

    /* Vale para todas as escolhas, e `ollama` entra pela URL, não por chave. */
    assert.deepEqual(provedoresDeclarados({ IARA_PROVEDOR: 'anthropic' }), []);
    assert.deepEqual(provedoresDeclarados({ IARA_PROVEDOR: 'openrouter' }), []);
    assert.deepEqual(provedoresDeclarados({ IARA_PROVEDOR: 'ollama' }), []);
    assert.deepEqual(
      provedoresDeclarados({ IARA_PROVEDOR: 'ollama', OLLAMA_URL: 'http://127.0.0.1:11434' }),
      ['ollama'],
    );
  });
});

/**
 * A FÁBRICA CONTINUA INSTANCIANDO O PROVEDOR FORÇADO SEM CHAVE, e a assimetria
 * com o teste acima é deliberada — não é descuido de cobertura.
 *
 * Quem instancia devolve um cliente INDISPONÍVEL, que diz em voz alta que está
 * indisponível e com a mensagem certa; é o modo honesto da casa e não deve
 * mudar. Quem RELATA não pode afirmar que existe cérebro. As duas coisas juntas
 * são o comportamento correto, e separá-las foi o conserto.
 */
test('forçar provedor sem chave instancia o cliente, mas ele nasce indisponível', async () => {
  await comProcessEnv({ IARA_PROVEDOR: 'groq', GROQ_API_KEY: undefined }, () => {
    const p = criarProvedorRaciocinio({ IARA_PROVEDOR: 'groq' });
    assert.equal(p.disponivel, false, 'sem chave, o provedor forçado não pode se dizer disponível');
    assert.deepEqual(provedoresDeclarados({ IARA_PROVEDOR: 'groq' }), [], 'e o relato não o anuncia');
  });
});
