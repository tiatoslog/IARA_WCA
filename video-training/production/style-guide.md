# style-guide.md — IARA LEARNING STUDIO

> **IARA LEARNING STUDIO** · Treinamento Operacional
> Posicionamento: universidade corporativa digital da Atos Log.

## Princípio

A identidade **herda** do produto em vez de competir com ele. O IARA OS já tem
uma decisão de marca registrada em `app/globals.css`, e criar uma segunda paleta
ao lado dela produziria dois IARAs. O que muda é o **meio**: o produto é uma sala
escura de vidro; o treinamento é **material impresso editorial** — claro, com
respiro, feito para ser lido em tela grande e no celular.

Dois invariantes do repositório valem aqui sem alteração:

1. **Nunca vermelho saturado.** Alerta é coral quente.
2. **Movimento calmo.** Ciclos longos, amplitude pequena, nada frenético.

E um invariante próprio desta produção:

3. **Cor nunca é decoração.** Todo tom tem função semântica declarada. Um
   elemento sem estado é cinza.

## Paleta

Contraste **medido**, não estimado (WCAG 2.1, sobre `--superficie` e `--papel`).

### Base

| Token | Hex | Função | Contraste |
|---|---|---|---|
| `--papel` | `#F4F5F7` | fundo do quadro | — |
| `--superficie` | `#FFFFFF` | cartões, área de captura | — |
| `--tinta` | `#1B1E23` | títulos e texto principal | **15,32:1** / 16,71:1 · AAA |
| `--tinta-fraca` | `#5B626B` | rótulos, metadados, rodapé | **5,65:1** / 6,17:1 · AA |
| `--linha` | `#D3D6DB` | divisórias, molduras | — |

`--papel`, `--tinta` e `--linha` são **os mesmos valores** de `globals.css`.

### Institucional

| Token | Hex | Função | Contraste |
|---|---|---|---|
| `--petroleo` | `#0E3A47` | barra de marca, faixa de etapa, fundo de abertura | **11,23:1** / 12,25:1 · AAA |
| `--acento` | `#2A7182` | indicador de progresso, ênfase de foco | **5,09:1** / 5,55:1 · AA |

Azul petróleo é a única cor de marca. Não há segunda cor institucional — o
briefing pede "uma cor secundária **discreta**", e `--acento` é a mesma matiz
clareada, não uma cor nova.

### Estados — semânticos, nunca decorativos

| Token | Hex | Preenchimento | Significa | Contraste |
|---|---|---|---|---|
| `--verde` | `#3F7A52` | `#A9CFB2` | **correto / concluído / confira** | **5,10:1** · AA |
| `--ambar` | `#8F5A00` | `#F5E1B8` | **atenção / prazo / exceção** | **5,30:1** · AA |
| `--coral` | `#A8442C` | `#F5CFC4` | **erro / bloqueio / não faça** | **5,46:1** · AA |

> `--coral` é coral quente escurecido até passar em AA. Não é vermelho saturado —
> o invariante do repositório está preservado, e a acessibilidade também.

**Regra de dupla codificação:** nenhuma informação depende só de cor. Todo estado
carrega **ícone + rótulo textual** (`✓ CONFIRA`, `! ATENÇÃO`, `✕ ERRO COMUM`).
Um daltônico e um espectador sem áudio recebem a mesma informação.

## Tipografia

**Família única: Segoe UI.**

Inter é a fonte do produto, carregada por `next/font` — **não existe como arquivo
no sistema** (verificado: nenhum `.ttf`/`.otf` no repositório, nada em
`C:\Windows\Fonts`). Segoe UI é humanista, nativa do Windows, metricamente
próxima, e não exige licenciar nem embarcar arquivo novo. Decisão registrada em
`environment.md`.

| Papel | Arquivo | Tamanho (1080p) | Peso | Cor |
|---|---|---|---|---|
| Título de abertura | `segoeuib.ttf` | 92 px | Bold | `--superficie` sobre `--petroleo` |
| Título de módulo | `segoeuib.ttf` | 64 px | Bold | `--tinta` |
| Subtítulo | `segoeuisl.ttf` | 38 px | Semilight | `--tinta-fraca` |
| Corpo / bullet | `segoeui.ttf` | 34 px | Regular | `--tinta` |
| Rótulo de cartão | `segoeuib.ttf` | 24 px | Bold, `+2px` entreletra, caixa alta | cor do estado |
| Indicador de passo | `segoeuib.ttf` | 28 px | Bold | `--acento` |
| Legenda (queimada) | `segoeuib.ttf` | 40 px | Bold | `--superficie` sobre tarja `--tinta` 82% |
| Rodapé normativo | `segoeui.ttf` | 22 px | Regular | `--tinta-fraca` |

Corpo nunca abaixo de **34 px** em 1080p. No corte 9:16 o piso sobe para **44 px**
— é o tamanho em que o texto continua legível num celular de 5".

## Grade

Quadro 1920×1080, margem de segurança **96 px** em todos os lados.
Coluna de conteúdo: 1728 px, dividida em 12 colunas de 128 px com calha de 24 px.

```
┌──────────────────────────────────────────────┐
│ ▌ IARA LEARNING STUDIO      ETAPA 2 · 03/16 │ ← barra de marca, 84 px
├──────────────────────────────────────────────┤
│                                              │
│   TÍTULO DO PASSO                            │ ← 64 px
│   subtítulo de apoio                         │
│                                              │
│   ┌────────────────────────────────────┐     │
│   │   CAPTURA REAL TRATADA             │     │ ← área de captura
│   └────────────────────────────────────┘     │
│                                              │
├──────────────────────────────────────────────┤
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░  IT-ADMLUFT-001 REV02│ ← trilho + rodapé, 72 px
└──────────────────────────────────────────────┘
```

O rodapé carrega **código e revisão do POP em todos os quadros**. Um frame
capturado fora de contexto ainda diz de qual norma veio.

## Componentes

Os 14 componentes do briefing, com regra fixa:

| # | Componente | Regra visual |
|---|---|---|
| 1 | **Abertura** | fundo `--petroleo` cheio, marca centralizada, sem captura |
| 2 | **Título de módulo** | faixa `--petroleo` 240 px, numeral da etapa em 140 px a 18% de opacidade atrás do título |
| 3 | **Indicador de progresso** | trilho de 6 px no rodapé, `--acento` sobre `--linha`, + `PASSO 03 / 16` na barra |
| 4 | **Cartão de objetivo** | superfície branca, filete `--petroleo` de 6 px à esquerda |
| 5 | **OBSERVE** | filete `--acento`, ícone de olho, rótulo `OBSERVE` |
| 6 | **FAÇA** | filete `--petroleo`, ícone de mão, rótulo `AGORA É SUA VEZ` |
| 7 | **CONFIRA** | filete `--verde`, ícone `✓`, rótulo `CONFIRA` |
| 8 | **ATENÇÃO** | fundo `#F5E1B8`, filete `--ambar`, ícone `!` |
| 9 | **ERRO COMUM** | fundo `#F5CFC4`, filete `--coral`, ícone `✕`, captura com máscara diagonal |
| 10 | **BOA PRÁTICA** | fundo `#A9CFB2` a 40%, filete `--verde`, ícone `✓` |
| 11 | **CHECKLIST** | lista com quadrados `--verde`, entrada escalonada de 240 ms |
| 12 | **RESUMO** | grade 2×3 de cartões numerados |
| 13 | **QUIZ** | pergunta em `--petroleo`, alternativas em cartões brancos, resposta revelada em `--verde` |
| 14 | **Encerramento** | `--petroleo` cheio + bloco de lacunas normativas em `--ambar` |

### Cartão de LACUNA — componente 15, próprio desta produção

Não estava no briefing. Existe porque o POP tem quatro lacunas reais
(`pop-audit.md`) e elas **precisam de forma visual própria** — dizer "o documento
não informa" com a mesma cara de uma instrução ensinaria a lacuna como se fosse
regra.

Filete `--tinta-fraca`, fundo hachurado a 8%, rótulo `O POP NÃO DEFINE`,
e sempre acompanhado da ação: **"confirme com o responsável pela conta"**.

## Tratamento da captura

Nenhuma captura aparece inteira e crua.

1. **Mascarar** dado pessoal (obrigatório, antes de tudo — `pop-audit.md` P0-1);
2. **Recortar** o supérfluo (inclusive a marca d'água "Ativar o Windows");
3. **Escalar** com Lanczos, teto de **2×** — acima disso borra;
4. **Assentar** em superfície branca com moldura `--linha` de 2 px e sombra suave;
5. **Escurecer** o que não é o foco: véu `--tinta` a 55% sobre o resto;
6. **Destacar** a região de interesse: retângulo `--acento` de 4 px, cantos de 8 px;
7. **Apontar**: seta ou cursor, com pausa antes da ação.

### Cursor

Tamanho 44 px. Trajetória com aceleração suave (ease-in-out), nunca linear.
**Pausa de 400 ms antes de cada clique**, anel de clique que expande de 0 a 72 px
em 320 ms e desvanece. Velocidade máxima 900 px/s — acima disso o olho perde.

## Movimento

Herda "movimento calmo" do repositório.

| Transição | Duração | Curva |
|---|---|---|
| Entrada de texto | 400 ms | ease-out, deslize de 24 px |
| Troca de cena | 500 ms | corte cruzado |
| Troca de etapa | 700 ms | cortina `--petroleo` da esquerda |
| Zoom na captura | 900 ms | ease-in-out |
| Entrada de cartão | 350 ms | ease-out, escala 0,96 → 1 |
| Item de checklist | 240 ms escalonados | ease-out |

Nenhuma animação passa de 900 ms. Nenhuma existe sem ensinar algo — o teste é
§18 do briefing: *o que isto ensina?* Se a resposta for "fica bonito", sai.

## Áudio

| Camada | Nível | Regra |
|---|---|---|
| Voz | −3 dBFS de pico, −16 LUFS | `pt-BR-FranciscaNeural`, sempre prioritária |
| Sound design | −28 dBFS | marcadores discretos de transição de etapa e de acerto |
| Música | **ausente** | ver `environment.md`, limitação 1 |

Sem música, a regra "abaixar sob explicação complexa" não se aplica — mas o
espaço está reservado no mix, e `render/mixagem.md` traz o comando pronto para
inserir trilha licenciada sem refazer o vídeo.

## Proibido

Herdado do briefing §9 e do CLAUDE.md do repositório:

holograma · robô · circuito · cérebro digital · partícula · neon · glow ·
interface futurista · avatar onipresente · transição 3D · zoom artificial ·
lens flare · vermelho saturado · fonte decorativa · imagem de banco genérica ·
animação sem função.

> A tecnologia está no sistema. Não na estética.
