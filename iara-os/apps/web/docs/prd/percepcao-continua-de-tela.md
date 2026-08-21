# Percepção contínua de tela — documento de arquitetura

Terceiro documento da linha do SOS, depois de `hierarquia-da-verdade-sos.md`
("a IARA não inventa procedimento") e `instrutor-operacional-adaptativo.md`
("a IARA ensina sem perder o controle operacional").

Este responde: **a IARA pode observar a tela continuamente sem que observar vire
autorizar — e sem virar vigilância.**

Nada aqui está implementado. É análise, contrato e plano, conforme pedido.

---

## 1. Arquitetura atual — o que existe hoje, medido no código

| Peça | Onde | O que faz hoje | Serve para percepção contínua? |
|---|---|---|---|
| Captura | `AgenteLocal.capturarTela` | `powershell.exe -Command <script>` desenha a tela num **PNG no disco do operador** (`<Documentos>/capturas/`) | **Não.** Um processo por quadro; centenas de ms e um arquivo por captura |
| Transporte | `Braco.ts` + `ExecutorDesktop.ts` | Ordem autorizada → fila serializada por operador → relato com `execucao_id` | **Sim, com ressalva:** é pensado para ordens discretas, não para fluxo |
| Análise | `AnaliseVisual.ts` | Cadeia Groq → Gemini → Anthropic sobre bytes de imagem; devolve texto, `alvo{x,y}`, `situacao` e `procedencia` | **Sim**, como consumidor sob demanda — nunca por quadro |
| Comparação | `ConferenciaDeTela.ts` | Lê a parada em curso, compõe leitura + POP, grava `ConferenciaDaParada` | **Sim.** É exatamente o consumidor certo da camada nova |
| Guarda | `GuardiaoDoProcedimento.ts` | `na_etapa` → evidência `anexada`; `outra_tela` → recusa; `indefinido` → não sustenta nada | **Sim, inalterado** |
| Entrada | `Kernel.ts`, bloco `if (anexo)` | Short-circuit: imagem anexada pelo operador, um quadro por turno | Precisa de um segundo caminho: evento, não anexo |

**O que NÃO existe:** laço de captura, detecção de mudança, hash de quadro,
OCR, estado visual estruturado, evento visual, indicador de percepção ativa,
política de retenção de imagem.

**A descoberta que muda o plano:** a captura atual **não pode** ser a base da
percepção contínua. `powershell.exe` por quadro custa processo, disco e
latência, e grava PNG na pasta Documentos do operador — o oposto de "não
armazenar imagens desnecessariamente". A percepção precisa de uma primitiva de
captura **em memória** no Braço.

---

## 2. Arquitetura proposta

```
  MÁQUINA DO OPERADOR (Braço)                    │      MOTOR (IARA)
                                                 │
  captura em memória (janela autorizada)         │
        │  ~1-2 Hz, quadro nunca sai daqui       │
        v                                        │
  dHash 64 bits  ──── igual ao anterior? ──> descarta
        │ mudou                                  │
        v                                        │
  diff por REGIÃO (grade 4x4)                    │
        │ região relevante mudou                 │
        v                                        │
  OCR local (janela + regiões alteradas)         │
        │                                        │
        v                                        │
  EventoVisual  ───────── só ISTO cruza a rede ──┼──> PercepcaoDeTela
  (texto mascarado, sem pixel)                   │         │
                                                 │         v
  quadro em memória, retido N segundos           │    EstadoVisual
        ^                                        │         │
        └── pedido explícito de análise ─────────┤         v
            (1 quadro, recortado)                │   ConferenciaDeTela
                                                 │         │
                                                 │         v
                                                 │    GuardiaoDoProcedimento
```

**As quatro regras de fronteira do desenho:**

1. **Quadro não atravessa a rede por padrão.** O que atravessa é evento com
   texto. Um quadro só sai da máquina quando a IARA pede uma análise visual
   para um evento específico — e isso é uma ação contável, auditável e cara.
2. **`PercepcaoDeTela` não escreve estado operacional.** Mesma trava da camada
   pedagógica: não importa `ProcedimentosEmCurso`, não move ponteiro, não
   conclui etapa. Produz evidência estruturada; quem decide é o guardião.
3. **`ConferenciaDeTela` não é renomeada.** Ela é a COMPARAÇÃO (tela × parada) e
   continua sendo. A camada nova é a OBSERVAÇÃO. Renomear porque "o nome ficou
   pequeno" é a refatoração ornamental que as próprias regras deste projeto
   proíbem — o que muda é que ela ganha uma segunda fonte de leitura.
4. **`AnaliseVisual` não muda.** Continua sendo a cadeia de provedores. Ela
   passa a ter dois chamadores (anexo do operador, evento da percepção) em vez
   de um.

---

## 3. Fluxo de dados, com números

| Etapa | Onde roda | Custo por quadro | Frequência |
|---|---|---|---|
| Captura em memória | Braço | ~5–15 ms (API nativa) | 1–2 Hz enquanto há procedimento em curso |
| dHash 64 bits (cinza 9×8) | Braço | < 1 ms | todo quadro |
| Diff por região | Braço | ~2 ms | só quando o hash muda |
| OCR local | Braço | 150–600 ms | só em região alterada, com debounce de ~800 ms |
| Evento pela ponte | rede | ~1–3 KB | só mudança relevante |
| Análise visual (LLM) | nuvem | 1 chamada + tokens de imagem | **só sob pedido**, com teto por turno |

**A conta que decide o desenho.** Uma jornada de 8 h a 1 Hz são 28 800 quadros.
Mandar cada um para um modelo multimodal é inviável em custo e em latência, e
seria uma cópia da tela do operador saindo da máquina 28 800 vezes por dia. Com
o funil acima, o número esperado de chamadas de visão é **da ordem de dezenas
por dia**: uma por transição de tela que importe para a parada em curso.

**Piso de captura:** enquanto não houver procedimento em curso, a frequência cai
a zero. Percepção sem procedimento não tem contra o que comparar — seria coleta
sem finalidade, que é a definição de vigilância.

---

## 4. Contratos propostos

`lib/percepcao.ts` — contrato compartilhado, puro, ao lado de `procedimento.ts`
e `treinamento.ts`.

```ts
/** De onde saiu uma observação. NUNCA é um número de crença. */
export type OrigemDaObservacao =
  | 'metadado_de_janela'   // título/processo da janela ativa — mecânico
  | 'hash_de_quadro'       // dHash: mudou / não mudou — mecânico
  | 'ocr'                  // texto lido na tela — mecânico, com erro próprio
  | 'modelo_de_visao';     // leitura de um modelo — RELATO, não medição

/**
 * A tela deu para ser lida? Terceiro eixo, como `QualidadeDocumental`.
 * NÃO é confiança: é uma propriedade da LEITURA, medida mecanicamente.
 */
export type QualidadeDaLeitura = 'nitida' | 'parcial' | 'ilegivel';

export interface EstadoVisual {
  readonly instante: string;
  readonly aplicacao: string | null;   // null = não foi possível identificar
  readonly janela: string | null;
  readonly hash_quadro: string;        // dHash hex — identidade do quadro
  readonly textos: readonly string[];  // JÁ MASCARADOS na origem
  readonly qualidade: QualidadeDaLeitura;
  readonly origens: readonly OrigemDaObservacao[];
}
```

**Campos recusados do rascunho, e por quê:**

| Campo pedido | Recusa |
|---|---|
| `confianca: 0.94` | É o auto-relato do modelo. Vira `origem: 'modelo_de_visao'` + `QualidadeDaLeitura`. Um float de crença ao lado de `Procedencia` é a segunda escala que o `CLAUDE.md` proíbe — e a que faria "0.94" ganhar de "o operador disse" sem ninguém ter decidido isso |
| `elementos: [botão, campo]` | Só é honesto se vier de acessibilidade (UIA) ou OCR com caixa. De pixel puro, "isto é um botão" é inferência do modelo — entra como texto observado, não como inventário de elementos |
| `posicao do cursor` | Exige hook de entrada. Ver §7 |
| `telaIdentificada` | A identidade da tela é COMPARAÇÃO, não observação. Mora em `ConferenciaDeTela`, contra o POP |

---

## 5. Eventos visuais — seis, não dez

```ts
export type EventoVisual =
  | { tipo: 'tela_alterada'; de: string; para: string }      // hashes
  | { tipo: 'tela_estavel'; hash: string; desde: string }
  | { tipo: 'texto_apareceu'; textos: readonly string[] }
  | { tipo: 'texto_sumiu'; textos: readonly string[] }
  | { tipo: 'mensagem_exibida'; texto: string }              // caixa modal/alerta
  | { tipo: 'leitura_impossivel'; motivo: string };
```

**Cortados de propósito:**

- `botao_acionado`, `campo_alterado` — **não são observáveis em pixel.** Afirmá-los
  exigiria hook de teclado/mouse (§7). Um evento que o sistema não tem como
  produzir honestamente é um evento que vai ser produzido por chute.
- `navegacao_detectada` — é `tela_alterada` com outro nome.
- `elemento_apareceu`/`desapareceu` — colapsados em `texto_apareceu`/`sumiu`
  enquanto a fonte for OCR. Voltam a existir se um dia a fonte for UIA.
- `possivel_erro` — **não é observação, é interpretação.** A percepção emite
  `mensagem_exibida`; quem decide se aquilo é erro é o diagnóstico, contra o
  conhecimento autorizado.
- `tela_nao_identificada` — é `leitura_impossivel` ou, do outro lado, a
  comparação devolvendo `indefinido`.

---

## 6. Comparação com o procedimento — duas perguntas, não uma

O rascunho propõe seis estados (`na_etapa`, `outra_tela`, `resultado_esperado`,
`resultado_nao_observado`, `desvio`, `indefinido`). Eles não cabem numa lista só
porque **respondem a duas perguntas diferentes**, e misturá-las é o que produz
estados sem entrada e sem saída:

```
ONDE VOCÊ ESTÁ?            SituacaoNaParada          (JÁ EXISTE — não mexer)
                           na_etapa | outra_tela | indefinido

O ESPERADO ACONTECEU?      TransicaoObservada        (NOVO)
                           mudou_para_esperada | mudou_para_outra
                           | sem_mudanca | indefinida
```

`desvio` == `outra_tela`. `resultado_nao_observado` == `sem_mudanca`, que é uma
resposta legítima e não uma falha: a pessoa ainda não fez.

`SituacaoNaParada` **não ganha valor novo**. É o tipo que o guardião já lê, e
acrescentar um valor ali obrigaria a revisar todas as portas que o consomem —
para dizer algo que é de outro eixo.

---

## 7. A regra que não se negocia: observar não é autorizar

**A VISÃO DIZ ONDE. O POP DIZ O QUÊ.** Já está escrita em `ConferenciaDeTela.ts`
e continua valendo palavra por palavra. A percepção contínua acrescenta uma
tentação nova e é preciso nomeá-la:

> Se a IARA vê a tela do resultado esperado, por que não avançar a etapa sozinha?

**Porque `inferencia` é mais fraca que `resultado_ferramenta`.** Uma leitura de
tela é dedução (`Verdade.ts`); a declaração do operador é relato de quem
executou. Deixar a dedução avançar o que o relato avança seria dar à evidência
mais fraca um poder que a mais forte não tem — e produziria um sistema que
percorre o procedimento sozinho enquanto a pessoa olha. É a falha dos
adversariais 27–29 voltando por uma porta nova.

**O que a percepção contínua PODE fazer, e é muito:**

| Pode | Não pode |
|---|---|
| Recusar: `outra_tela` já bloqueia o avanço hoje | Autorizar o avanço |
| Oferecer: *"a tela mudou para o que esta etapa esperava — quer que eu avance?"* | Avançar sem a palavra do operador |
| Alertar na borda: *"você saiu da tela prevista"* | Repetir o alerta enquanto persiste (regra do `Vigia`) |
| Observar mensagem e procurar orientação no POP | Inventar solução para erro não coberto |
| Enriquecer o treinamento com dificuldade real observada | Concluir que o operador "fez errado" |

**Nenhum `TipoDeEvidencia` novo.** `observada` seria um degrau que o guardião não
saberia tratar. O que a percepção produz continua sendo `ConferenciaDaParada` —
o mesmo tipo, com `origem` acrescentada — e continua valendo `anexada` só quando
`na_etapa`, amarrada a código+etapa+slide+hash como já é.

---

## 8. Erros observados

```
mensagem_exibida("Erro 1145: CT-e sem autorização")
        │
        v
busca no conhecimento AUTORIZADO (POPs, particularidades, memória corporativa)
        │
        ├── achou  → orienta, verbatim, com citação
        └── não achou → "observei a mensagem X; não há orientação para ela na
                         documentação que eu tenho" + LacunaCapacidade
```

Nunca há um terceiro ramo. A mensagem observada entra como `inferencia` (foi
OCR, pode ter lido errado) e sai citada como texto lido, não como fato.

---

## 9. Privacidade e segurança — a parte que decide se isto pode existir

Captura contínua da tela de um funcionário é **infraestrutura de vigilância**
por padrão. O que a torna legítima é um conjunto de restrições que precisam
nascer com a primeira linha, não depois:

1. **Escopo por janela.** Captura só quando a janela ativa é a aplicação
   autorizada para o procedimento (o GW). Trocou de janela → captura para e o
   evento é `leitura_impossivel: fora do escopo`. O WhatsApp pessoal do
   operador nunca entra no funil.
2. **Consentimento por sessão, não por instalação.** A percepção liga quando o
   operador começa um procedimento e aceita; desliga ao encerrar. Nunca fica
   ligada por configuração esquecida.
3. **Indicador visível e sempre presente** na projeção enquanto a percepção
   estiver ativa — é campo do `SnapshotCognitivo`, pela mesma razão de todo o
   resto: se acende, é porque está acontecendo agora.
4. **Parada imediata pelo operador**, sem passar pela IARA.
5. **Quadro não persiste.** Vive em memória no Braço por uma janela curta (~30 s)
   para poder ser analisado se um evento pedir, e é descartado. Nada em disco.
6. **Texto mascarado na ORIGEM.** O OCR de uma tela do GW lê CPF de motorista,
   placa, valor de frete. A máscara é a mesma de `assinaturaDeLacuna` (dígitos e
   e-mails → `n`) e roda **no Braço**, antes de o evento existir. Duas políticas
   de máscara no mesmo repositório é como as duas passam a discordar.
7. **Retenção do evento** igual à do estado interno: fica no processo, particionado
   por operador, com teto.
8. **Auditoria de quando a percepção esteve ativa** — o registro de que a IARA
   observou é tão importante quanto o que ela observou.
9. **Nada disso é `EFEITO_EXTERNO`**, mas a captura sai do processo: entra em
   `Fronteira.ts` com declaração própria e teste, como toda peça nova.

**Se qualquer um dos itens 1, 2, 3 ou 6 não couber no prazo, a percepção
contínua não entra.** Um sistema que observa sem avisar não é uma versão
incompleta desta arquitetura — é outra coisa.

---

## 10. Custos, latência e viabilidade técnica

**O bloqueio real:** o Braço é Node e não tem primitiva de captura em memória.
As opções, com o que cada uma custa:

| Opção | Latência/quadro | Custo |
|---|---|---|
| `powershell.exe` por quadro (hoje) | 200–400 ms + processo + PNG em disco | **Inviável** para laço |
| Módulo napi nativo (ex.: `node-screenshots`) | 5–15 ms, buffer em memória | Dependência compilada no pacote do Braço (`empacotar-braco`) |
| Windows Graphics Capture via helper C#/Rust próprio | 3–10 ms | Mais controle, mais código para manter |
| Electron/Tauri `desktopCapturer` | ~16 ms | Só se o desktop virar o hospedeiro do Braço |

**Recomendação:** módulo napi para o P0, com degradação explícita — sem ele, a
percepção contínua simplesmente **não liga**, e a IARA diz isso, em vez de cair
no `powershell` e fingir que observa.

OCR: `tesseract.js` (WASM, sem instalação) resolve o P0; um binário nativo é 3–5×
mais rápido e é decisão do P2, medida e não chutada.

---

## 11. Relação com treinamento

A percepção enriquece a instrutora sem mudar nenhuma das travas dela:

- `tela_alterada` para a tela esperada → a instrutora **oferece** o avanço.
- `outra_tela` durante execução guiada → alerta **na borda**, uma vez.
- `mensagem_exibida` → alimenta `diagnosticar` com o texto real do erro, que é
  exatamente o que hoje a IARA precisa pedir ao operador.
- `sem_mudanca` prolongada numa parada → dificuldade observada, e é a primeira
  fonte de dificuldade deste sistema que **não depende de a pessoa reclamar**.

E nenhuma delas escreve no `ProgressoDeTreinamento` por conta própria: quem
registra continua sendo a habilidade, no turno em que responde.

---

## 12. Plano por fases

| Fase | Entrega | Rede | Risco |
|---|---|---|---|
| **P0 — IMPLEMENTADO em 21/08/2026** | `lib/percepcao.ts` (contrato puro) + captura em memória + dHash + detecção de mudança + escopo por janela + consentimento + indicador + evento pela ponte + `EstadoVisual` no motor | só evento (~293 B) | baixo |
| **P1** | `EventoVisual` pela ponte + `PercepcaoDeTela` no motor + indicador no snapshot + consentimento por sessão + parada pelo operador | eventos | médio — é aqui que a privacidade se decide |
| **P2** | OCR local + `mensagem_exibida` + busca de orientação no conhecimento autorizado | eventos | médio |
| **P3** | Análise visual **sob evento** (um quadro, recortado, com teto de orçamento) → `ConferenciaDaParada` com `origem` | 1 quadro por evento relevante | alto — é o ponto em que a tela sai da máquina |
| **P4** | Oferta de avanço e alerta de desvio na execução guiada | — | médio |
| **Fora de escopo** | hook de teclado/mouse, execução pelo Braço a partir da visão | — | decisão separada, com outro documento |

---

## 13. Testes

- **Determinísticos, sobre fixtures.** Pares de PNG gravados em
  `testes/fixtures/telas/`; nenhuma captura ao vivo em CI.
- dHash: quadro idêntico → mesmo hash; ruído de compressão → mesmo hash; troca de
  tela → hash distante. Limiar **medido** por script de calibração, como o do
  corpus de POPs — nunca escolhido no olho.
- Máscara: nenhum evento produzido carrega dígito longo ou e-mail.
- Fronteira: `PercepcaoDeTela` não importa `ProcedimentosEmCurso`; nenhum quadro
  em `EventoVisual`.
- Guardião: uma sequência de eventos "perfeita" (tela esperada observada) **não**
  avança a etapa sem declaração — o adversarial central desta fase.
- Escopo: janela fora da allowlist não gera evento nenhum.
- Privacidade: percepção ativa sem indicador no snapshot é falha de teste.

---

## 14. Riscos

1. **A tentação do avanço automático.** É o risco número um e ele é de produto,
   não de código: alguém vai pedir "se a IARA já viu, por que perguntar?".
   A resposta está em §7 e precisa estar em teste.
2. **Vigilância por acidente.** Escopo de janela mal feito transforma isto em
   gravador de tela do funcionário.
3. **Custo de inferência escapando.** Sem teto por turno, um GW que pisca vira
   uma conta mensal.
4. **OCR confiante e errado.** "Erro 1145" lido como "Erro 1146" manda a pessoa
   ao procedimento errado. Por isso `QualidadeDaLeitura` e citação do texto lido.
5. **Dependência nativa quebrando o pacote do Braço** em máquina sem
   redistribuível — daí a degradação explícita.
6. **Latência criando falsa sincronia.** Um alerta que chega 4 s depois descreve
   uma tela que já não está lá. O evento carrega instante e a IARA cita o
   instante.
