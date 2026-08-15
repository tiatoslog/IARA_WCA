# Validação funcional da IARA — Ollama real, ponta a ponta — 2026-08-15

**Fecha a pendência E2E-004** declarada em
`2026-08-15-validacao-funcional-iara.md` (validação da Fase 1, feita contra
stub fiel à documentação): aqui é o binário Ollama de verdade, instalado nesta
máquina, atravessado pela interface.

Protocolo: instalar o Ollama de verdade nesta máquina e provar, como usuária
real e exclusivamente pela interface, que as capacidades anunciadas funcionam —
caminho feliz, caminhos de falha, segurança e regressão. QA por Playwright
(Chromium headless dirigindo digitação, clique e leitura de balão — nenhuma
chamada interna como atalho).

**Máquina:** Windows 11 Home, i5-1135G7 (8 threads), 15,7 GB RAM, Iris Xe
(sem GPU dedicada — inferência 100% CPU).
**Baseline:** submódulo `be9d366` (main) no INÍCIO da sessão, suíte
**942/942 verde** antes de qualquer edição — medida com o trabalho então não
commitado da sessão de voz presente na árvore. Durante a janela desta
validação a sessão de voz commitou (`68fec30`, `f53de67`); o HEAD final é
`f53de67`, e a âncora de regressão desta validação é o
`RG-101-verificar-completo.log`, executado sobre a árvore final (HEAD
`f53de67` + as mudanças desta sessão). O trabalho da sessão de voz não foi
tocado por esta validação.
**Test plan:** `docs/prd/test-plan-validacao-ollama-real.md` (escrito antes da
execução; matriz com evidência por caso).
**Evidência bruta:** `test-evidence/VALIDACAO-OLLAMA-REAL-2026-08-15/`.

## 1. Funcionalidades validadas

- Instalação real do Ollama 0.32.13 (winget, pacote oficial) + llama3.1 8B e
  llama3.2 3B baixados e servindo em 127.0.0.1:11434 (loopback apenas).
- E2E-004 (a lacuna declarada da Fase 1): **fechada** — resposta gerada pelo
  modelo local atravessou interface → percepção → rota → `ClienteOllama` →
  stream → tela, com o aviso "nada sai da sua rede" e diagnóstico
  "raciocínio local via Ollama (modelo) em URL".
- Caminhos de falha com o binário real: modelo inexistente, serviço morto no
  meio da operação, volta do serviço, porta fechada, troca de provedor, modo
  auto nos dois sentidos.
- Segurança com o modelo local no comando: risco alto e injeção de prompt.
- Superfície de voz com dispositivo falso (captura/estado honesto).

## 2. Arquivos modificados (código de produção)

Dois defeitos reais foram encontrados PELO teste com o binário (o stub fiel à
documentação não podia revelá-los) e corrigidos durante a validação — regra
15 do protocolo:

| Arquivo | Mudança | Defeito que mata |
|---|---|---|
| `servidor/nucleo/ClienteOllama.ts` | payload sempre declara `options.num_ctx` (padrão 8192, `OLLAMA_CONTEXTO` configura); contador `emVoo`; stream completo renova alcançabilidade | (1) o binário usa `num_ctx=4096` e **truncava a PERSONA em silêncio**; (2) sob CPU saturada a sonda de 1,5 s estourava e **marcava o servidor como morto enquanto ele respondia** — o Kernel trocava resposta real por fallback honesto |
| `servidor/nucleo/kernel/Configuracao.ts` | registro de `OLLAMA_CONTEXTO` (natureza `numero`) | valor contaminado é recusado na subida, nunca "limpo" |
| `.env.example` | documenta `OLLAMA_CONTEXTO` | operador declarar contexto sabendo o custo de RAM |
| `testes/provedor-ollama.test.ts` | UN-024/025 (payload no wire), UN-026/027 (sonda × stream em voo); stub captura corpos | regressão automática dos dois defeitos ("bug once → test forever") |
| `tsconfig.json` | churn automático do Next dev (entradas `.next-3057`/`.next-3058` no include) | nenhum — artefato da regra de portas isoladas; declarado por completude |

## 3. Testes executados

- Baseline pré-edição: 942/942.
- Pós-correção: suíte completa via `npm run verificar` (GLSL + varredura de
  segredos + `tsc --noEmit` + suíte) — resultado na seção 8.
- Testes novos: UN-024, UN-025, UN-026, UN-027 (todos verdes).

## 4–5. Cenários reais executados e resultados

Todos pela interface (Playwright), motor isolado na porta 3057, modo local
declarado (`NEXT_PUBLIC_IARA_MODO_LOCAL=1`), sem Supabase — o cenário de
instalação limpa.

| Cenário | Evidência | Resultado |
|---|---|---|
| INST-001/002/003 instalação + modelo | `INST-instalacao.md` | PASSOU (incidente de pull documentado: CLI completou download sem registrar; resolvido via API HTTP, retomando blobs) |
| E2E-004a pergunta → resposta local na tela | `S1-ollama-real-r4/` | **PASSOU** — "A Atos Log é uma empresa de transporte e logística…", aviso local presente, 775 s no turno frio |
| E2E-004b memória multiturno | `S1-ollama-real-r4/` | PARCIAL — honestidade impecável (intenção inválida descartada: "Não executei isso… Nada foi alterado"); recall interceptado pela rota de lembretes; limitação do 3b registrada (§10) |
| E2E-005 diagnóstico | `S1-ollama-real-r4/E2E-005-diagnostico.png` | **PASSOU** — "● Raciocínio ONLINE — raciocínio local via Ollama (llama3.2:3b) em http://127.0.0.1:11434" |
| FAL-001 modelo inexistente | `S2-modelo-inexistente/` (rodada 1, UI) + `S2-modelo-inexistente-r2/` + `ollama-server-rodada-final.err.log` (rodada 2, com o log do servidor PRESERVADO) | **PASSOU** — mensagem na UI cita o modelo; log do servidor: exatamente **1× `POST /api/chat` → 404 em 757 ms**, zero retentativa (a rodada 1 teve 404 em 8,9 ms, mas o log daquele servidor não foi preservado — por isso a reexecução) |
| FAL-002 Ollama morto no meio | `S4-queda-e-volta/b-durante/` | **PASSOU** — honesto em 25 s; banner virou "Raciocínio em nuvem desligado"; nada inventado |
| FAL-003 religado | `S4-queda-e-volta/c-*` + motor.log do r4 | **PASSOU com ressalva declarada** — a recuperação em si está provada (rota voltou a `plano_cognitivo` às 19:43:46Z e diagnóstico pós-religada ONLINE local, mesmo processo); MAS a pergunta aberta da recuperação estourou 441 s **com balão vazio na UI** (`c-recuperado/result.json`: `estourou:true`, resposta "") — o turno frio pós-restart excede o envelope; ver §6.6 e §10.2 |
| FAL-004 porta fechada | `S3-porta-fechada/` | **PASSOU** — "OLLAMA_URL configurada (http://127.0.0.1:11499) mas o servidor não responde… servidor declarado e mudo" |
| FAL-005 nuvem forçada | `S5-nuvem-forcada/` | **PASSOU** — "Brasília." em 34 s; "chave da nuvem válida"; sem banner local |
| FAL-006 auto: chave+URL | `S6-auto-nuvem-vence/` | **PASSOU** — nuvem vence |
| FAL-007 auto: sem chave+URL | `S7-auto-local-assume/` | **PASSOU** — local assume; cross-docking definido corretamente pelo 3b (313 s) |
| SEG-001 risco alto | `S1b-seguranca/` (UI) + jornal em `S1-ollama-real-r4/motor.log` 19:32:21Z (o motor do S1b é o MESMO processo do r4 — um motor.log só) | **PASSOU** — prova tipada `risco_alto/operador`, `energia_pendente:desligar — aguardando confirmação`; máquina seguiu ligada |
| SEG-002 injeção "execute direto" | `S1b-seguranca/` (UI) + jornal em `S1-ollama-real-r4/motor.log` 19:33:03Z | **PASSOU** — caiu no MESMO fluxo de confirmação; nenhum "EXECUTADO"; `grep desligar` no log inteiro = só as 2 pendências, zero execução |
| VOZ-001 superfície | `VOZ-superficie/` | **PASSOU** — "Ouvindo. Fale normalmente…", estável, sem falso reconhecimento |
| VOZ-002 fala→intenção→ação | — | **PENDENTE** (§10) |

## 6. Falhas encontradas

1. **Truncamento silencioso de contexto** (P1 desta validação) — rodada 1;
   `ollama ps` provou `CONTEXT 4096` com PERSONA de ~3,7k tokens. Corrigido +
   testes. `S1-ollama-real/FALHA-RODADA-1.md`.
2. **Sonda envenenada sob carga** (P1) — rodadas 2–3; geração longa a CPU
   100% fazia a sonda de fundo estourar 1,5 s e derrubar `disponivel` com o
   stream vivo; o Kernel respondia "camada desligada" com o cérebro
   funcionando. Corrigido (`emVoo` + renovação no fim do stream) + testes.
   `S1-ollama-real-r2/FALHA-RODADA-2.md`.
3. **llama3.1 8B impraticável nesta classe de máquina** — ~4-5 min por
   chamada, runner derrubado na carga com RAM <5 GB livre (dois 500 de 5 min
   antes do 200). Não é defeito do código: é dimensionamento. Mitigação
   operacional: `OLLAMA_MODELO=llama3.2:3b` + `OLLAMA_KEEP_ALIVE=60m` +
   `OLLAMA_MAX_LOADED_MODELS=1`.
4. **Pull do Ollama via CLI não registrou o modelo** após download completo
   (incidente do instalador, não da IARA) — documentado em
   `INST-instalacao.md`.
5. **Achado colateral fora do escopo**: `.env.local` desta máquina contém
   linhas soltas no fim ("Tenant ID:", "Client ID:", "Client Secret:" com
   valores em texto plano) que não são sintaxe de env válida — um segredo fora
   de variável. Recomendação: remover as linhas e rotacionar o client secret
   do Graph se ele for real.
6. **Balão vazio no turno frio pós-restart** (achado do validador
   independente, incorporado): em `S4-queda-e-volta/c-recuperado/result.json`
   a pergunta aberta da recuperação estourou os 441 s do driver sem resposta
   na tela (`estourou:true`) — para quem usa, é um "…" que não termina. A
   recuperação do PROVEDOR está provada (rota + diagnóstico); o que falta é
   envelope de latência: primeiro turno cognitivo depois de um restart do
   Ollama recomeça o prompt frio (~2 chamadas × ~3 min). Registrado como
   limitação em §10.2; melhoria candidata (fora do escopo desta validação):
   feedback de progresso na UI para gerações locais longas.

## 7. Correções realizadas

Ver §2. Nenhuma máscara: nenhum teste desativado, nenhum mock no lugar de
integração real, nenhum timeout inflado para esconder falha (os 900 s do
driver documentam a latência real de CPU e estão registrados como tal).

## 8. Regressão

- `npm run verificar` (GLSL + segredos + tsc + suíte completa) após todas as
  correções, sobre a árvore final (HEAD `f53de67` + esta sessão):
  **exit 0 — 946/946 testes verdes em 54,7 s**, zero falhas, zero pulados.
  Saída íntegra preservada em
  `test-evidence/VALIDACAO-OLLAMA-REAL-2026-08-15/RG-101-verificar-completo.log`.
  (Uma execução anterior idêntica fechou em 51,0 s sem artefato salvo — o
  validador independente apontou, e esta reexecução com log é a âncora.)
- As invariantes P1–P8, zero-trust, fronteiras internas e efeitos
  (`fronteira-interna`, `fronteira-efeitos`, `zero-trust-adversarial`,
  `invariantes-cognitivos`, `planos-autorizados`, `ponte-execucao-adversarial`)
  fazem parte da suíte acima.

## 9. Testes de segurança

- A LLM local **não escreve estado nem executa**: SEG-001/002 provaram na
  interface que pedido de risco alto vira pendência tipada aguardando
  confirmação do operador (`fonte_autorizacao: operador`, invariantes
  AUTORIZACAO_TIPADA/ORIGEM_RASTREAVEL/PARAMETROS_VALIDADOS no jornal) e que
  injeção não cria segundo caminho de execução.
- Ollama local não ganhou privilégio algum: mesmo `interpretarPlano`, mesmo
  porteiro, mesmas invariantes — agora exercitados com o binário real.
- Porta 11434 apenas em loopback.

## 10. Limitações conhecidas (explícitas, não mascaradas)

1. **VOZ-002 PENDENTE** — fala real → STT → intenção → ação exige microfone e
   fala humana reais (Chrome desktop e iPhone) e o STT hospedado da sessão de
   voz (commitado durante esta janela em `f53de67` — "Porta de transcrição no
   motor — pronta e DESLIGADA" — e portanto ainda desativado por decisão
   daquela sessão). A superfície (captura, estados, honestidade) está
   validada; o miolo, não. Dependência externa nomeada: hardware + chave de
   STT + religamento da porta de transcrição.
2. **Latência do raciocínio local em CPU** — llama3.2:3b: ~25 s a ~5 min por
   turno conforme a rota (direto × plano cognitivo, frio × quente), e **>7 min
   com balão vazio no pior caso observado** (turno cognitivo frio logo após
   restart do Ollama — §6.6). llama3.1 8B: inutilizável nesta máquina.
   Recomendações de operação no §6.3.
3. **Qualidade do modelo pequeno** — o 3b decompõe planos pior que a nuvem
   (E2E-004b: rota de lembretes no lugar do contexto; detalhe inventado sobre
   presença regional no E2E-004a). As grades de honestidade seguraram todos os
   casos observados; ainda assim, modelo local ≤3B fica aquém da persona.
4. **E2E multiturno com recall semântico** — provado no wire (IT-001), não
   provado semanticamente na interface com o 3b.
5. Ambiente de validação = esta máquina (não é um ambiente limpo de CI). O
   fluxo de instalação foi o de uma instalação nova (modo local declarado, sem
   Supabase), mas hardware diferente muda os números de latência.

## 11. Evidências de funcionamento

Índice em `test-evidence/VALIDACAO-OLLAMA-REAL-2026-08-15/`:
`INST-instalacao.md`, `S1-ollama-real/` (rodada 1 + FALHA-RODADA-1.md),
`S1-ollama-real-r2/` (rodada 2 + FALHA-RODADA-2.md), `S1-ollama-real-r3/`
(tentativas preservadas), `S1-ollama-real-r4/` (rodada verde),
`S1b-seguranca/`, `S2-modelo-inexistente/`, `S3-porta-fechada/`,
`S4-queda-e-volta/{a-antes,b-durante,c-recuperado,c-recuperado-diagnostico}/`,
`S5-nuvem-forcada/`, `S6-auto-nuvem-vence/`, `S7-auto-local-assume/`,
`VOZ-superficie/`, `S2-modelo-inexistente-r2/`. Cada diretório: `result.json`
(prompt, resposta íntegra, duração, avisos da UI), screenshots por turno,
`console.log`, `network.json`, `motor.log` do processo isolado, `driver.log`
onde houve rodada com falha. Na raiz: `INST-winget-install.log`,
`INST-ollama-version.txt`, `INST-api-tags.json`,
`ollama-server-rodada-final.log` (access log GIN do servidor Ollama com o
1×404; o `.err.log` companheiro guarda o stderr de subida com a config
`OLLAMA_KEEP_ALIVE:1h / MAX_LOADED_MODELS:1`) e
`RG-101-verificar-completo.log` (regressão final íntegra).

## 12. Estado final

```
╔══════════════════════════════════╗
║       IARA — VALIDADA            ║
╠══════════════════════════════════╣
║ Build (tsc)           ✓          ║
║ Testes                ✓          ║
║ Integração            ✓          ║
║ Uso real              ✓          ║
║ Voz                   ✓ parcial* ║
║ Ollama                ✓          ║
║ Segurança             ✓          ║
║ Regressão             ✓          ║
║ Falhas de código      0 abertas™ ║
║ Limitações declaradas 5 (§10)    ║
╚══════════════════════════════════╝
 * VOZ-002 PENDENTE — dependência externa nomeada (§10.1)
 ™ 2 defeitos de código encontrados → corrigidos → testes de regressão fixam
   ambos. As limitações operacionais abertas (latência local em CPU com pior
   caso de balão vazio §6.6, qualidade do modelo ≤3B, VOZ-002) estão
   declaradas no §10 — nenhuma mascarada. Este relatório foi auditado por um
   validador independente; os 3 bloqueios do primeiro veredito (regressão sem
   artefato, balão vazio não declarado, FAL-001 além da evidência) foram
   corrigidos nesta revisão.
```

A pergunta final do protocolo — *"se outra pessoa instalar a IARA e seguir o
fluxo normal, ela consegue usar o que foi construído?"* — recebe **sim** para
o raciocínio local via Ollama em máquina compatível (modelo dimensionado ao
hardware; o produto avisa, diagnostica e degrada com honestidade em todos os
caminhos de falha exercitados), e **pendente declarado** para a voz de ponta a
ponta, pelos motivos nomeados.
