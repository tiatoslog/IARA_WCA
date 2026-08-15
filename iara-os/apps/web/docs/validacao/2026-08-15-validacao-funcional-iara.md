# Validação funcional — ProvedorRaciocinio (Anthropic + Ollama) — 15/08/2026

Ciclo governado pelo orquestrador de garantia (baseline → test plan antes do
código → implementação → testes → E2E como usuário real → evidência).
Test plan: `docs/prd/test-plan-provedor-raciocinio.md`.
Evidência bruta: `test-evidence/PROVEDOR-OLLAMA-F1-2026-08-15/`.

## 1. Funcionalidades implementadas

- Contrato `ProvedorRaciocinio` (`servidor/nucleo/ProvedorRaciocinio.ts`) com
  `normalizarHistorico` compartilhada e erro `ProvedorIndisponivel`.
- `ClienteOllama` (`servidor/nucleo/ClienteOllama.ts`): streaming JSON-por-linha,
  sonda `/api/tags` com TTL e getter não-bloqueante, retentativa com taxonomia
  própria (404 não retenta), parser puro testável.
- `FabricaRaciocinio` (`servidor/nucleo/FabricaRaciocinio.ts`):
  `IARA_PROVEDOR` = anthropic | ollama | auto; **auto exige OLLAMA_URL
  declarada** (infraestrutura declarada, nunca descoberta); `estadoRaciocinio()`
  para o autodiagnóstico com sonda ativa.
- `PERSONA` extraída para `servidor/nucleo/Persona.ts` (14.757 chars provados
  idênticos ao HEAD por comparação normalizada).
- Tri-estado `origem_raciocinio` ('nuvem'|'local'|'nenhuma') no estado e no
  snapshot; `nuvem_indisponivel` preservado com a semântica original; os dois
  gravados sob a mesma trava.
- Telemetria: `RACIOCINIO_INICIADO.origem`; narrador distingue "Raciocinando
  localmente com X" / "Acionando X na nuvem"; `diagnosticar_sistema` distingue
  ONLINE-nuvem / ONLINE-local / OFFLINE (declarado e mudo) / DEGRADADO
  (deliberado) / OFFLINE (chave contaminada).
- Config: `IARA_PROVEDOR`, `OLLAMA_URL` (natureza url), `OLLAMA_MODELO` no
  REGISTRO + `.env.example` com orientação de segurança de rede.
- Correção da 2ª fonte de verdade do modelo (`MotorRaciocinio.modelo` lia
  `process.env` cru).

## 2. Arquivos modificados

Novos: `servidor/nucleo/{Persona,ProvedorRaciocinio,ClienteOllama,FabricaRaciocinio}.ts`,
`testes/{normalizacao-historico,provedor-ollama,fabrica-raciocinio,origem-raciocinio}.test.ts`.
Modificados: `ClienteClaude.ts` (diff de 400 linhas de patch, restrito à lista
autorizada — RG-003), `MotorRaciocinio.ts`, `Configuracao.ts`, `Fronteira.ts`,
`EstadoAtomico.ts`, `CompiladorSnapshot.ts`, `Kernel.ts`, `Evento.ts`,
`Porta.ts`, `PonteProjecao.ts`, `diagnostico.ts`, `lib/estado.ts`,
`lib/snapshot.ts`, `hooks/useIaraSocket.ts`, `components/PainelConversa.tsx`,
`.env.example`, `testes/{persona,autoconhecimento,fronteira-efeitos}.test.ts`.

## 3–5. Testes e cenários executados / resultados

| Capacidade | Entrada | Resultado esperado | Resultado real | Evidência |
|---|---|---|---|---|
| Nuvem intacta (E2E-000) | pergunta aberta via UI, chave real | resposta da nuvem; sem aviso; diagnóstico ONLINE | ✓ resposta correta em 1 frase; "chave da nuvem válida" | E2E-000/resultado.md |
| Ollama local (E2E-002) | pergunta aberta via UI, sem chave, stub em socket real | aviso "raciocínio local"; resposta do caminho local; diagnóstico ONLINE local com URL | ✓ tudo conforme; stub logou sonda + planejador + síntese | E2E-002/resultado.md + stub-ollama.log |
| Declarado e mudo (E2E-003) | OLLAMA_URL de porta fechada | diagnóstico OFFLINE com endereço; resposta honesta | ✓ "servidor declarado e mudo"; honesta com as duas causas | E2E-003/resultado.md |
| Nenhum provedor (E2E-001) | sem chave, sem URL | aviso clássico; DEGRADADO deliberado | ✓ byte a byte o aviso original | E2E-001/resultado.md |
| Modelo inexistente | 404 do stub | falha SEM retentativa | ✓ 1 requisição no contador | UN-022, RG-001-suite-completa.log |
| Timeout de sonda | porta fechada | false em <2 s | ✓ medido | UN-020 |
| Resposta malformada | linha inválida no stream | ignorada sem matar o stream | ✓ | UN-012 |
| Erro transitório | 500 → sucesso | retenta 1×, conclui | ✓ contador=2 | UN-023 |
| Aborto meio-stream | AbortSignal no 2º pedaço | nenhum pedaço depois; sem retentativa | ✓ | IT-002 |
| Servidor morre pós-sonda | fechar stub | erro tratado + cache zerado | ✓ | IT-003 |
| Troca de provedor / modo auto | matriz de ambientes | forçado vence; auto exige URL; contaminada levanta | ✓ 7 casos | fabrica-raciocinio.test.ts |

## 6–7. Falhas encontradas e correções

1. A5 (`autoconhecimento.test.ts`) quebrou quando `capacidades?: string` migrou
   para o contrato — generalizado para vigiar a camada inteira (5 arquivos).
   Prevista no plano.
2. `fronteira-efeitos A2` + `fronteira-interna G4/G4d` exigiram declaração do
   `ClienteOllama` com justificativa escrita — feita (LEITURA_EXTERNA +
   POST_SEM_EFEITO). Era o desenho do teste funcionando.
3. TS2339 no teste IT-002 (narrowing de variável atribuída em callback) —
   corrigido com holder.
4. Durante a suíte, 3 falhas em `Transcricao.ts` — arquivo de OUTRA sessão
   (voz), corrigidas pela própria sessão dona; fora do diff desta mudança.

## 8. Regressão

`npm test`: **936/936 verde** (908 do baseline + 28 novos), incluindo
propriedades-criticas (P1–P8), zero-trust-adversarial, fronteira-interna,
fronteira-efeitos, autoconhecimento, persona. `tsc --noEmit`: 0 erros.
GLSL + varredura de segredos: verdes. Logs em test-evidence/.

## 9. Segurança

- P1–P8 e zero-trust: verdes na suíte completa (RG-001).
- O Ollama NÃO ganha privilégio por ser local: entra pelo MESMO
  `MotorRaciocinio` → `interpretarPlano` (habilidade inventada mata o plano
  inteiro) → `PorteiroAutorizacao` → invariantes. Nenhuma porta nova; a
  fronteira ganhou o arquivo declarado com justificativa conferida por teste
  (G4d exige a razão por escrito).
- Prompt injection: cláusula pétrea + marcadores de material não confiável
  inalterados (prefixo idêntico); zero-trust-adversarial verde.
- E2E-000 registrou o comportamento "fato é medido": a IARA recusou aceitar
  capacidade afirmada pelo usuário e exigiu o diagnóstico antes de responder.

## 10. Limitações conhecidas (explícitas, não mascaradas)

- **E2E-004 — PENDENTE**: validação contra o binário Ollama REAL não pôde ser
  executada (Ollama não instalado nesta máquina; instalação = download de
  ~GB + serviço novo, não autorizada nesta sessão). O contrato de wire foi
  coberto por servidor HTTP real fiel à documentação (`/api/tags`, `/api/chat`
  NDJSON, `prompt_eval_count`/`eval_count`). Risco residual: divergência entre
  a documentação do Ollama e o binário. Para fechar: instalar Ollama, `ollama
  pull llama3.1`, declarar `OLLAMA_URL=http://127.0.0.1:11434` e repetir o
  roteiro do E2E-002.
- Screenshots compostos não puderam ser capturados (painel de navegador sem
  exibição em sessão autônoma); a evidência visual é a árvore de acessibilidade
  + texto integral da página, preservados nos resultado.md.
- Shard de QA compartilhado entre cenários produz o comportamento descrito em
  E2E-000/observação (característica, não defeito).

## 11–12. Estado final

╔══════════════════════════════════════════╗
║       IARA — FASE 1 VALIDADA             ║
╠══════════════════════════════════════════╣
║ Build (tsc)                    ✓         ║
║ Testes (936/936)               ✓         ║
║ Integração (socket real)       ✓         ║
║ Uso real (4 cenários E2E UI)   ✓         ║
║ Voz                            N.A.*     ║
║ Ollama (stub fiel)             ✓         ║
║ Ollama (binário real)          PENDENTE  ║
║ Segurança (P1–P8, zero-trust)  ✓         ║
║ Regressão                      ✓         ║
║ Falhas conhecidas              0         ║
╚══════════════════════════════════════════╝
* Voz está em desenvolvimento ativo por outra sessão nesta mesma árvore
  (Transcricao.ts, sonda-voz); validá-la aqui colidiria com trabalho em curso.
