# Test Plan — versão mínima do braço (Stage 1 do sistema de atualização) — 2026-08-14

## BASELINE

- `BASELINE_ID`: `VERSAO-BRACO-2026-08-14-F1`
- Submódulo `IARA_WCA`: branch `main`, commit `6aade0e` (correção de QR/vigília/roteador/abrir-site já publicada).
- Motivo: braço `.exe`, uma vez instalado, fica congelado na versão que baixou para sempre — nenhum mecanismo detecta ou avisa quando ele fica atrasado em relação ao que o motor espera. Confirmado por auditoria de código (não existe comparação de `versao` em nenhum ponto do handshake).
- Escopo desta etapa (Stage 1 de 3, acordado com o operador): **detecção e aviso**, sem download nem substituição automática do executável. Isso fica para a Stage 2 (Updater separado), que exige seu próprio test-plan.

## O que foi implementado

- `lib/execucao.ts` — `VERSAO_MINIMA_BRACO` (fonte única da verdade) e `versaoBracoDesatualizada(versao)`, comparação semver simples (major.minor.patch, sem qualificadores).
- `servidor/barramento/PonteDispositivos.ts` (`inventarioDeMaquinas`) — cada `MaquinaDoOperador` ganha o campo `desatualizada: boolean`, calculado a partir da versão já reportada no handshake (`pacote.versao`, já existia — só não era comparada com nada).
- `lib/execucao.ts` (`MaquinaDoOperador`) — novo campo `desatualizada: boolean`.
- `components/Dispositivos.tsx` — aviso por máquina quando `desatualizada`, com link para `NEXT_PUBLIC_IARA_INSTALADOR`.

## A. Fluxos principais

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | VM-001 | unit | — | `versaoBracoDesatualizada('1.0.0')` com mínima `1.1.0` | `true` | teste automatizado | LOW |
| [x] | VM-002 | unit | — | `versaoBracoDesatualizada('1.1.0')` com mínima `1.1.0` | `false` (igual não é desatualizada) | teste automatizado | LOW |
| [x] | VM-003 | unit | — | `versaoBracoDesatualizada('1.2.0')` com mínima `1.1.0` | `false` | teste automatizado | LOW |
| [x] | VM-004 | unit | — | `versaoBracoDesatualizada(null)` | `false` — não afirma o que não apurou (mesma disciplina do resto do projeto: `sem_meio_de_verificar` nunca vira acusação) | teste automatizado | MEDIUM (falso positivo seria pior que silêncio) |
| [x] | VM-005 | integration | braço conectado reportando versão abaixo da mínima | `inventarioDeMaquinas` | `desatualizada: true` na máquina correspondente | teste automatizado com `PonteDispositivos` real | MEDIUM |
| [x] | VM-006 | integration | braço conectado na versão mínima ou acima | `inventarioDeMaquinas` | `desatualizada: false` | teste automatizado | LOW |

## B. Fluxos não óbvios

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | VM-007 | edge case | máquina PAREADA mas OFFLINE agora (`versao: null` vindo do banco, nunca conectou nesta sessão) | `inventarioDeMaquinas` | `desatualizada: false` — sem dado ao vivo, não acusa | teste automatizado | MEDIUM |
| [x] | VM-008 | edge case | string de versão malformada (`"abc"`, `""`, `"1"`) | `versaoBracoDesatualizada` | não lança exceção; trata segmento não numérico como `0` | teste automatizado (fuzzing leve) | LOW |
| [x] | VM-009 | UI | máquina desatualizada aparece na gaveta Dispositivos | abrir a gaveta | aviso visível, com link de download | screenshot real (Browser pane) | LOW |
| [x] | VM-010 | regressão | máquina atualizada (comportamento de sempre) | abrir a gaveta | nenhum aviso novo aparece — UI idêntica à de antes desta mudança | screenshot real | LOW |

## Regra de execução

Stage 1 não tem câmera nem segunda máquina física envolvida — é testável inteiramente com a suíte real (`npm test`) e o app real rodando (`npm run dev`), sem as limitações de ambiente que bloquearam partes do QR. Não há desculpa para deixar algo aqui como UNVERIFIED.

## Evidência

- VM-001 a VM-008: `testes/pareamento.test.ts` (seção 7), rodado de verdade: 28/28 nesse arquivo, `tsc --noEmit` limpo.
- VM-005 a VM-007 usam `PonteDispositivos`/`inventarioDeMaquinas` REAIS (não mock) com um `RegistroPareamento` de teste — o mesmo padrão já estabelecido no resto da suíte de pareamento.
- VM-009: braço real (`npx tsx servidor/braco/principal.ts`, credencial isolada, `VERSAO` temporariamente rebaixada para `'1.0.0'` e revertida logo depois — diff confirmado limpo após reverter) pareado contra o motor local de verdade. Texto real capturado da página: `"versão do programa desatualizada — baixe a versão nova"`, dentro da linha da máquina conectada. Pareamento desfeito e processo encerrado depois.
- VM-010: todo pareamento real feito ANTES desta mudança nesta mesma sessão (braço em `1.1.0`, versão atual = mínima) nunca mostrou o aviso — confirma a regressão sem precisar repetir o teste.
- Suíte completa: 849 passam; 1 falha (`A2. nenhum fetch a provedor externo...`, `testes/fronteira-efeitos.test.ts`) — **não relacionada a esta mudança**: aponta `servidor/nucleo/ClientePlanilhaOcis.ts`, um arquivo de uma sessão concorrente (commits `914ce3a`..`e9f7758`, já em `origin/main`) que este trabalho nunca tocou. Confirmado via `git diff --stat` nos arquivos desta mudança: só os 4 arquivos listados acima em "O que foi implementado".

## Decisão

**GO** para Stage 1. Nenhum item ficou UNVERIFIED. A falha pré-existente (`A2`) é de outra sessão e não bloqueia este merge — mas fica registrada aqui para não desaparecer.
