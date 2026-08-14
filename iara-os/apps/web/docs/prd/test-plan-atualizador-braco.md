# Test Plan — Etapa 2 (Updater automático) + Etapa 3 (notas de versão) — 2026-08-14

## BASELINE

- `BASELINE_ID`: `ATUALIZADOR-BRACO-2026-08-14-F1`
- Em cima do commit `ce55343` (Stage 1: detecção e aviso de versão mínima).
- Pedido do operador: "PRECISAMOS AUTOMATIZAR ISSO" + "a instalação do braço como a atualização precisam ser feitas automaticamente, tudo sincronizado" — confirmado explicitamente depois de eu descrever o risco (braço não pode sobrescrever o próprio `.exe` rodando; precisa de um processo separado).

## Escopo

- **Dentro:** operador clica "Atualizar agora" na gaveta Dispositivos → motor manda ordem ao braço específico pelo socket já existente → braço baixa a versão nova, valida SHA256, fecha, substitui o arquivo, reabre sozinho → reconecta e o handshake confirma a versão nova → PWA mostra barra de progresso em tempo real durante o processo. Notas de versão (changelog "para leigos") aparecem junto do aviso.
- **Fora, nomeado:** assinatura de código (certificado — decisão de quem tem CNPJ, mesma nota já registrada em `empacotar-braco.ts`), rollback automático, atualização obrigatória/forçada, histórico de versões. Ficam para uma Etapa 3 de verdade, se pedida.
- **Primeira instalação continua manual — e não tem como não ser.** Uma máquina sem NADA da IARA não tem processo nenhum rodando para receber uma ordem de atualização; alguém precisa baixar e abrir o `.exe` uma vez. "Automatizar" aqui quer dizer: depois desse primeiro passo, a máquina nunca mais fica presa numa versão velha sozinha.

## O que muda, por arquivo

| Arquivo | Mudança |
|---|---|
| `lib/execucao.ts` | novos tipos de pacote (`atualizar`, `progresso_atualizacao`, `atualizacao_falhou`); `MaquinaDoOperador.atualizando`; manifesto (`MANIFESTO_BRACO`: versão, sha256, notas, url) lido de `NEXT_PUBLIC_IARA_INSTALADOR*` |
| `lib/protocolo.ts` | `PacoteCliente` ganha `atualizar_dispositivo` |
| `servidor/barramento/PonteDispositivos.ts` | trata `progresso_atualizacao`/`atualizacao_falhou` antes de repassar a `Braco.ts` (não são execução); expõe `atualizando` no inventário |
| `servidor/barramento/Porta.ts` | recebe `atualizar_dispositivo` do navegador, resolve o dispositivo, manda a ordem |
| `servidor/braco/principal.ts` | trata `atualizar`: baixa com progresso, valida SHA256, escreve script de religamento, spawn detached, sai |
| `testes/fronteira-efeitos.test.ts` | `servidor/braco/principal.ts` entra no `PERMITIDOS` do A4, com justificativa — é o processo se automantendo na própria máquina, não o motor alcançando o mundo por alguém |
| `hooks/useIaraSocket.ts` | `atualizarDispositivo(id)` |
| `components/Dispositivos.tsx` | botão "Atualizar agora", barra de progresso, notas de versão |
| `scripts/empacotar-braco.ts` | imprime o SHA256 do `.exe` gerado, para colar em `NEXT_PUBLIC_IARA_INSTALADOR_SHA256` |

## A. Fluxos principais

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | AT-001 | integration | braço conectado, desatualizado, manifesto válido | operador clica "Atualizar agora" | braço recebe a ordem, baixa, valida, substitui, reabre; reconecta com a versão nova | teste automatizado + execução REAL do binário | CRITICAL |
| [ ] | AT-002 | integration | download em andamento | — | PWA recebe `progresso_atualizacao` em tempo real (não só a cada 15s do poll de sempre) | teste automatizado (assinatura publica sem esperar poll) | HIGH |
| [ ] | AT-003 | E2E real | build real do braço, servidor de arquivo real | rodar o fluxo inteiro fora da suíte, com o `.exe` de verdade | processo antigo sai, processo novo sobe sozinho, PID muda, versão nova no log | execução real, log real, PID capturado antes/depois | CRITICAL |

## B. Fluxos não óbvios / falha

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | AT-004 | security | SHA256 do download não bate com o esperado | braço recebe `atualizar` e baixa um arquivo adulterado/corrompido | braço RECUSA, manda `atualizacao_falhou`, NÃO substitui nada, continua rodando a versão antiga | teste automatizado (servidor de arquivo fake devolvendo bytes errados) | CRITICAL — é a defesa contra update malicioso |
| [ ] | AT-005 | rede | download cai no meio | — | mesma coisa: falha relatada, versão antiga intacta, braço continua atendendo | teste automatizado | HIGH |
| [ ] | AT-006 | UI | braço não está conectado agora | operador tenta atualizar mesmo assim | botão desabilitado ou recado claro — nunca manda ordem para o vazio | teste automatizado / leitura de UI | MEDIUM |
| [ ] | AT-007 | concorrência | duplo clique em "Atualizar agora" | — | uma atualização só é disparada; a segunda é ignorada ou vira no-op, nunca dois downloads simultâneos pisando no mesmo arquivo temporário | teste automatizado | MEDIUM |
| [ ] | AT-008 | segurança/fronteira | grafo do projeto | `spawn`/`execFile` só onde declarado | `testes/fronteira-efeitos.test.ts` (A4) continua passando com a exceção nova e JUSTIFICADA — nenhum outro arquivo ganha `spawn` de graça | suíte real | HIGH |
| [ ] | AT-009 | regressão | braço já atualizado (versão = mínima) | abrir a gaveta | nenhum botão/barra aparece — comportamento idêntico ao de antes desta mudança | teste automatizado + screenshot | LOW |

## Regra de execução

AT-003 é o item que decide se isto funciona de verdade fora de um mock: precisa rodar o `.exe` de verdade, apontado para um servidor de arquivo real, isolado (credencial de teste, nunca a de produção), e observar o PID mudar. Sem isso, "os testes passam" não prova que um `.exe` real sobrevive a substituir a si mesmo no Windows.
