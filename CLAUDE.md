# IARA OS — instruções do repositório

## ⚠️ Antes de mexer em código: você está no repositório-pai

Este diretório **não tem código vivo**. Ele carrega o ponteiro do submódulo, a
documentação e a mídia. O produto inteiro mora em `IARA_WCA/iara-os/apps/web/`.

O pai e o submódulo apontam para o **mesmo** remoto
(`github.com/tiatoslog/IARA_WCA.git`), em branches diferentes:

| branch | conteúdo |
|---|---|
| `main` | o código — é o submódulo `IARA_WCA` |
| `repositorio-pai` | este diretório: ponteiro, documentação, mídia |

Os dois compartilham a raiz `8764fec` e divergiram em `9db8cd1`, quando este
repositório virou o pai. **O HEAD do submódulo não é ancestral do HEAD daqui**:
um `git push origin main` a partir deste diretório é recusado, e um `--force`
apagaria o código do GitHub. Nunca force `main` daqui.

Havia até 13/08/2026 uma cópia de `iara-os/` versionada neste repositório — um
retrato de antes da separação, parado desde então. Ela foi removida porque uma
cópia velha com cara de código bom é pior que nenhuma cópia. Continua na
história (`fa5d85f` e anteriores); para consultá-la:
`git show fa5d85f:iara-os/apps/web/<arquivo>`.

Os caminhos citados no resto deste documento são relativos a
`IARA_WCA/iara-os/apps/web/`.

## O que é

Escritório digital vivo da Atos Log. **Não é um dashboard futurista.** A
interface é consequência do ambiente: ao propor qualquer elemento novo, a
pergunta é *"que objeto da sala é isto?"* — nunca *"que componente de dashboard
preciso?"*. A sensação-alvo é "não estou usando um sistema de gestão, estou
entrando no escritório da IARA".

## Onde as coisas vivem

```
iara-os/apps/web/
  lib/            contrato de domínio, compartilhado servidor↔cliente
  servidor/       motor cognitivo (processo próprio, porta 8787)
    nucleo/       estado, roteador, ações, RAG, teoria da mente, Claude
    barramento/   fila de telemetria e sessão WebSocket
  app/, components/, hooks/   camada de projeção (Next, porta 3000)
    components/projecao/      projeção "presença": avatar 3D (R3F)
  dados/          base determinística + shards privados (gerados)
  public/escritorio/        pixel art
  public/identidade_iara/   modelo 3D — ver components/projecao/EXPORTACAO.md
```

## Duas projeções, um contrato

`SnapshotCognitivo` (`lib/snapshot.ts`) é a única coisa que atravessa a fronteira
do kernel. Duas projeções o consomem e nenhuma conhece o servidor:

- **Escritório** — a sala em pixel art. Lê `luzes` e `estagio`.
- **Presença** — a IARA enquadrada do peito para cima, em React Three Fiber.
  Lê `expressao`, `capacidades`, `plano` e `telemetria`.

Trocar de projeção não muda uma linha do servidor. Nenhum componente conhece
nome de morph target, pela mesma razão que nenhum conhece nome de arquivo de
sprite: a tradução mora em `components/projecao/mapaFacial.ts`.

Articulação de boca é o único parâmetro reamostrado no cliente. O kernel publica
na cadência de aglutinação da ponte; lipsync precisa de 60 Hz. O fato é o mesmo —
o texto que o kernel emitiu — só a taxa de amostragem muda.

## Invariantes — não negociáveis

**Nomenclatura.** Português para termos de domínio: `MotorCognitivo`,
`EstadoAtomico`, `EstagioCognitivo`, `CapacidadeAtiva`, `MemoriaOperacional`,
`TeoriaDaMente`, `alterar_energia`. Infraestrutura genérica pode herdar nome de
mercado (`WebSocket`, `AbortController`). Campos de dados em `snake_case`
português (`energia_cognitiva`), classes em `PascalCase`.

**Todo evento visual nasce de um fato observado no loop do agente.** Se um
objeto acende, é porque a capacidade correspondente está em uso *agora*. Nunca
acenda nada para "dar vida".

**Presença ≠ informação.** Duas famílias de animação, jamais misturadas:
- *Ambiente* (luz respirando, planta, vapor, poeira) — nunca reage a dado,
  nunca para. Existe só para a sala não morrer visualmente.
- *Reativa* (halo, LED do rack, avatar) — só muda porque um campo de
  `EstadoEscritorio` mudou.

Misturar as duas faz a tela mentir.

**Hierarquia espacial fixa:** Ambiente → Objetos → HUD → Conteúdo → Painéis.
O escritório domina o campo visual; o painel de trabalho é a camada mais
externa e recuada. Nunca inverter.

**Movimento calmo.** Ciclos de 4–20 s para ambiente, amplitude pequena. Piso de
~0,8 s mesmo em "pensando" — frenético quebra a identidade.

**Nunca vermelho saturado.** Alerta é coral quente (`--luz-alerta`).

**A LLM não escreve estado.** Ela emite intenções estruturadas; o
`EstadoAtomico` valida e aplica sob trava. Intenção inválida é descartada com
log, nunca aplicada pela metade.

**O RAG nunca injeta log bruto.** Só hash, assinatura sintática de uma linha e
a resolução adotada. É o contrato que protege contexto e custo.

**Shards privados.** O caminho do shard é derivado do `id_usuario` da sessão.
O operador nunca informa qual shard quer ler. Sondagem cruzada é barrada no
roteador (determinístico) *antes* de ser barrada no prompt.

## Referências de estilo

VisionOS, Arc, Linear, JARVIS, Monument Valley, Alto's Odyssey são inspiração
conceitual. Se um elemento parece "saído de outro produto reconhecível", foi
longe demais — a IARA precisa de identidade própria.

## Arte

Pack em uso: **"Free Office Pixel Art", de arlantr** — licença *free to use any
way you want*, sem restrição comercial (o projeto é comercial). Créditos em
`iara-os/apps/web/CREDITOS.txt`.

Antes de propor asset novo, checar nesta ordem: (1) permite uso comercial?
(2) permite servir o arquivo por HTTP, onde ele fica baixável por URL direta?

O pack não traz parede, piso, janela, rack nem quadro — tudo isso é desenhado à
mão em `components/ArquiteturaSala.tsx`, no mesmo grid de pixels. Trocar de pack
significa editar `lib/cenario.ts` e mais nada: nenhum componente conhece nome de
arquivo.

## Rodando

```bash
cd iara-os/apps/web
npm install
npm run dev          # motor (8787) + web (3000), um comando
```

Sem `ANTHROPIC_API_KEY` o sistema roda completo em modo local e **avisa isso na
interface** em vez de improvisar resposta.

⚠️ Não rode `npm run build` com o `npm run dev` ativo — os dois compartilham
`.next` e o dev quebra. Se acontecer: `npm run limpar`.
