# Decisão arquitetural — IARA como plataforma local-first (15/08/2026)

Origem: propostas externas trazidas pela operação em 15/08 (Ollama, Onyx, Vibe,
Perfect Memory, n8n; "Iara Brain" com 9 engines; rede "Iara Server + Iara Node
+ celular"; lista de 12 áreas de capacidade). Método: confronto com o código
real de `IARA_WCA/iara-os/apps/web` por exploração sistemática ANTES de
qualquer decisão. Princípio herdado do roadmap A–F: **estender camadas
existentes, nunca reconstruir**.

## 1. Veredito central

Dos ~17 conceitos da proposta "Iara Brain", **12 já existem no kernel em forma
igual ou mais rigorosa**, 2 existem parcialmente, e só 3 não existiam:
provedor local (Ollama) — **entregue em 15/08 (Fase 1, validada)** —, MCP e
sandbox de execução de código (ausência intencional: a IARA não roda código
arbitrário, por desenho).

| Conceito proposto | Realidade no código | Onde | Maturidade |
|---|---|---|---|
| Intent Engine | `MotorPercepcao` + `Enunciacao` (citação/negação não viram pedido) + `PortaoSigilo`. `RoteadorIntencoes` foi DISSOLVIDO de propósito — recriá-lo reintroduziria a duplicação que causou o bug documentado em `Percepcao.ts:44-52` | kernel/Percepcao.ts, Enunciacao.ts, Sigilo.ts | Alta |
| Planning Engine | Duplo: `Planejador` (receitas determinísticas ~5ms) + `MotorRaciocinio.planejar` (LLM, ≤6 passos, habilidade inventada mata o plano) | kernel/Planejador.ts, MotorRaciocinio.ts | Alta |
| Reasoning/Análise | `MotorAnalise`: medição→evidência→anomalia→hipótese→recomendação; confiança CALCULADA, nunca digitada | kernel/MotorAnalise.ts, Investigacao.ts | Alta (domínio estreito) |
| Memory Engine | 4 níveis nomeados (Trabalho→Sessão→Persistente→Base) + `MemoriaFatos` (procedência+conflito) + `MemoriaDeSolucoes` (procedural) + temporal parcial (`Quando.ts`, `Verdade.ts`) | kernel/MemoriaTrabalho.ts etc. | Alta |
| Safety Engine / "Guardian" | TRÊS camadas ortogonais: `SandboxPorPolitica` → `PorteiroAutorizacao` → `PoliticaRisco`, mais `Invariantes` P1–P8 com ponto de imposição testado ("LLM nunca autoriza"; risco alto só de plano determinístico) | kernel/PorteiroAutorizacao.ts, PoliticaRisco.ts, Invariantes.ts | Muito alta — mais forte que a proposta |
| Tool Engine | `GerenciadorHabilidades` com 4 portas (existe→permissão→esquema→timeout); `PortalEfeitos` é a única fronteira ao mundo; manifesto em TypeScript checado em compilação | kernel/GerenciadorHabilidades.ts, PortalEfeitos.ts | Muito alta |
| Verifier | `verificacao` por manifesto + `Verdade.ts` tri-estado sucesso/falhou/DESCONHECIDO; risco médio/alto sem verificador não entra no catálogo | kernel/Habilidade.ts, Verdade.ts | Muito alta |
| Model Router | **Não existia** → entregue: `ProvedorRaciocinio` + `FabricaRaciocinio` (ver §3) | nucleo/FabricaRaciocinio.ts | Nova |
| Context Manager | Montagem em `Kernel.responder()` — boa qualidade, baixo encapsulamento; candidato legítimo a módulo próprio (fase futura) | kernel/Kernel.ts | Média |
| Personality Engine | `PERSONA` (spec comportamental de ~270 linhas, prefixo cacheado) + modulação por `TeoriaDaMente` | nucleo/Persona.ts | Alta |
| Agentic RAG | `RagHistorico` lexical schema-only (hash+assinatura+resolução, nunca log bruto) — decisão declarada, não limitação ignorada | nucleo/RagHistorico.ts | Média |
| Deep Research | Só embrião (`BuscaWeb` single-shot). **Lacuna real nº 1** | nucleo/BuscaWeb.ts | Baixa |
| MCP | Não existe; papel ocupado pelo GerenciadorHabilidades | — | — |
| Sandbox de código | Não existe e é intencional; `child_process` confinado ao `AgenteLocal` com allowlist | — | — |

O que o código tem e nenhuma proposta externa mencionou (preservar a qualquer
custo): `Verdade.ts` (o estado `desconhecido` governa o verbo da resposta),
`Invariantes.ts` (segurança conferível, não documentada), `Fronteira.ts`
(prova por grafo de chamadas), `Enunciacao.ts`, e os comentários que registram
defeito reproduzido + data.

## 2. Decisão por projeto externo

| Projeto | Decisão | Razão |
|---|---|---|
| **Ollama** | 🟢 ADOTADO (Fase 1 entregue) | MIT — embutível e redistribuível comercialmente; API local com streaming; gerência de modelos resolvida |
| **Onyx** | 🟡 Só inspiração conceitual | Deep Research multi-hop é a ideia a levar; incorporar código não vale a complexidade |
| **Vibe/Whisper** | 🟡 Candidato STT local (fase futura) | Voz está em evolução ativa por outra frente; decidir lá |
| **Perfect Memory** | 🔴 Não incorporar | Os 4 níveis + MemoriaFatos + MemoriaDeSolucoes já cobrem episódica/semântica/procedural |
| **n8n** | 🟡 Integração OPCIONAL futura, nunca dependência | Licença fair-code (Sustainable Use License) **proíbe embutir em produto distribuído a terceiros**; self-host interno ok. Entra como capability atrás do porteiro; criação de workflow pela IARA = risco médio/alto com aprovação humana |
| **MCP** | 🔴 Por ora | Ecossistema sem necessidade presente; abriria superfície que o kernel controla por desenho |
| **"Iara Guardian"** | 🔴 Não construir | Já existe e é testado (P1–P8 + zero-trust) |

## 3. Fase 1 — entregue e validada em 15/08/2026

`ProvedorRaciocinio` (contrato) + `ClienteClaude` (nuvem, comportamento
preservado com diff auditado) + `ClienteOllama` (local) + `FabricaRaciocinio`
(anthropic | ollama | auto — **auto exige `OLLAMA_URL` declarada**: nada
auto-descobre infraestrutura). Tri-estado `origem_raciocinio` no snapshot;
diagnóstico distingue ONLINE-nuvem / ONLINE-local / OFFLINE declarado-e-mudo /
DEGRADADO deliberado. 936/936 testes; E2E de interface em 4 cenários com
evidência em `IARA_WCA/iara-os/apps/web/test-evidence/PROVEDOR-OLLAMA-F1-2026-08-15/`.
Invariante mantida: **o modelo local tem exatamente a autoridade do modelo de
nuvem — nenhuma**. Pendência explícita: E2E contra binário Ollama real
(não instalado na máquina de desenvolvimento; roteiro de fechamento no
relatório de validação).

Regra de segurança de rede registrada: o Ollama não tem autenticação própria —
`OLLAMA_URL` só aponta para localhost ou rede privada (LAN/Tailscale/
WireGuard), nunca endereço público. Motor hospedado na nuvem só alcança um
Ollama doméstico por túnel privado; a alternativa local-first é rodar o motor
inteiro em casa.

## 4. Topologia distribuída — a proposta "Iara Server + Iara Node + celular" já existe em esqueleto

- **"Iara Server"** = o motor cognitivo atual (kernel 8787 + web), fora da
  máquina do operador desde 12/08 (Railway).
- **"Iara Node"** = o **Braço** (`servidor/braco/principal.ts`): serviço
  instalável por máquina; a `PonteDispositivos` inverte a direção (desktop é
  cliente pendurado no servidor) — NAT/firewall resolvido sem porta aberta.
- **Identidade por dispositivo + QR + instalador** = já existem (botão
  "Instalar automação" no PWA, pareamento por QR, aba Dispositivos, credencial
  por dispositivo, `execucao_id` com idempotência e suíte adversarial).
- O que falta de verdade: (1) raciocínio local nos nós — o Braço executa
  ações, não pensa; (2) roteamento de raciocínio entre máquinas (nó anuncia
  capacidade — modelo, VRAM — via protocolo do Braço; a fábrica escolhe
  provedor por dispositivo). É a extensão natural da Fase 1 sobre a ponte que
  já existe.

## 5. Mapeamento da lista de 12 áreas de capacidade (15/08)

- **Já existe** (não reconstruir): planejamento em etapas, causa-raiz,
  replanejamento em falha, risco antes de agir, explicar a escolha
  (justificativa da rota), detecção de contradição (MemoriaFatos), níveis de
  autonomia (Autonomia.ts é TETO, nunca concessão), verificação pós-ação
  tri-estado, operação do computador com verificação (Braço+AgenteLocal),
  proatividade na borda (Vigia), "IARA Investigator" (MotorAnalise/
  Investigacao — hoje restrito a lentidão de máquina), auto-diagnóstico
  (diagnosticar_sistema — ampliado na Fase 1 com o estado do provedor),
  aprendizado comportamental com validação (MemoriaDeSolucoes desempata, nunca
  decide; TeoriaDaMente observável).
- **Parcial**: pesquisa (single-shot); memória temporal; visão (nenhuma);
  voz (em evolução por outra frente — Transcricao/STT já surgindo).
- **Não existe**: Deep Research multi-hop com fontes; visão/entendimento de
  tela; múltiplos agentes especializados (e a recomendação é NÃO fazer por
  ora — especializações internas compartilhando memória/segurança, quando
  houver demanda); MCP; IoT.

## 6. Roadmap recomendado (uma coisa por vez, com ciclo de evidência)

1. ✅ Fase 1 — ProvedorRaciocinio + Ollama (entregue 15/08).
2. Fechar E2E-004 (Ollama binário real) na máquina da operação.
3. **Deep Research** — multi-hop + síntese com fontes sobre a BuscaWeb e a
   camada analítica existentes (maior lacuna real; zero problema de licença).
4. Ampliar o domínio do Investigator (hoje só lentidão) — mesma espinha
   medição→evidência→hipótese, novos sensores.
5. Ollama por nó + roteamento de raciocínio entre máquinas (estender Braço).
6. STT local (Whisper) — coordenar com a frente de voz.
7. n8n opcional (caso de uso concreto puxando; licença respeitada).
8. MCP / visão / multi-agentes — só sob demanda comprovada.
