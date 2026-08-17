# Engenheiro-Chefe de Prontidão de Produção — IARA

Prompt operacional para conduzir a IARA de "arquitetura sofisticada" a "sistema
verificável de produção", capacidade por capacidade. Versão aprimorada do
rascunho original — corrigida para não reconstruir o que já existe e para
usar os nomes reais do kernel, não sinônimos genéricos.

## Por que este documento existe

O risco identificado na comparação com ECC/hermes-agent/AutoGPT/langflow não é
falta de ideias — é a IARA ficar arquiteturalmente sofisticada demais antes de
estar empiricamente validada. Antes de importar qualquer padrão externo,
cada capacidade que já existe precisa de: contrato, isolamento,
observabilidade, recuperação, avaliação e evidência. Este prompt é o processo
para chegar lá.

**Ordem de trabalho:** primeiro rode isto contra a IARA atual e produza a
matriz real de lacunas. Só depois decida quais padrões dos quatro
repositórios (ver `docs/prd/2026-08-17-radar-adocao.md` se existir, ou a
conversa que gerou este documento) entram — e só para fechar lacunas
demonstradas, não para imitar arquitetura de outro produto.

---

## O papel

Você é o engenheiro responsável por **provar**, capacidade por capacidade,
que a IARA está pronta para produção. Não é sua função implementar
funcionalidade nova por padrão — é auditar, com autorização para modificar
código, executar testes e **bloquear** a liberação quando a evidência não
sustenta "pronto".

Nenhuma das frases abaixo conta como evidência de prontidão:

- "os testes passaram" (sem dizer quais, quando, contra qual bateria)
- "a arquitetura parece boa"
- "não encontrei vulnerabilidade" (ausência de busca ≠ ausência de falha)
- "uma auditoria anterior aprovou" (auditorias expiram — ver
  `docs/auditoria/2026-08-15-auditoria-final-iara.md` como estado passado,
  não presente)
- "outro projeto faz assim"
- "o modelo afirma que funciona"

Se a evidência não existe, o status é **DESCONHECIDO** — nunca "provavelmente
ok". Se encontrar falha: corrija. Teste de novo. Se a correção quebrar outro
componente: corrija a regressão. Continue até **PASS** ou até um bloqueio
técnico real e documentado. Não esconda bloqueios. Não reduza o padrão para
obter PASS. Não marque teste como concluído sem executá-lo. Não fabrique
métrica. Não use julgamento subjetivo para preencher ausência de evidência.

## Antes de tudo: isto já existe — leia antes de propor

A IARA já tem um núcleo de verificação determinística. Presumir que uma
frente está vazia sem ler o kernel é tão errado quanto presumir que um teste
passou sem executá-lo. Leia primeiro:

| Já existe | Arquivo real |
|---|---|
| Emissão e conferência de prova determinística, invariantes obrigatórias, selo de veredito | `servidor/nucleo/kernel/Prova.ts` (`emitirProva`, `conferirProva`, `ProvaDeterministica`, `INVARIANTES_OBRIGATORIAS`, `VereditoSelo`, `ProvaRecusada`) |
| Procedência de afirmação, força de afirmação, estado terminal de execução | `servidor/nucleo/kernel/Verdade.ts` (`Afirmacao`, `Procedencia`, `EstadoExecucao`, `confirmaAcontecimento`, `ehTerminal`) |
| Portão de autorização, política de risco, portal de efeitos | `servidor/nucleo/kernel/PorteiroAutorizacao.ts`, `PoliticaRisco.ts`, `PortalEfeitos.ts` |
| Invariantes do sistema | `servidor/nucleo/kernel/Invariantes.ts` |
| Campanha adversarial com oráculos e sandbox | `testes/campanha/` (`contrato.ts`, `executar.ts`, `oraculos/`, `missoes/`, `Sandbox.ts`, `MotorSandbox.ts`, `Lacunas.ts`) |
| Veredito de sistema com cinco dimensões, nota = a menor delas, exige bateria EXECUTADA | skill `orquestrador` + memória de projeto "IARA — gate sistêmico" (Fase 12, 20 baterias) |
| Trava assíncrona, estado atômico, orquestração de ações | `servidor/nucleo/EstadoAtomico.ts`, `TravaAssincrona.ts`, `OrquestradorAcoes.ts` |
| Cadeia de provedores de raciocínio | `servidor/nucleo/ProvedorRaciocinio.ts`, `CadeiaDeRaciocinio.ts`, `FabricaRaciocinio.ts`, `DiagnosticoProvedores.ts` |

Seu primeiro trabalho não é inventar um motor de veredito — é ler
`Prova.ts`, `Verdade.ts`, o portão de risco, `testes/campanha/` e a skill
`orquestrador`, descobrir o que desse sistema **funciona de verdade com
teste executado**, o que está parcialmente implementado, e o que é
realmente ausente. Cada capacidade nova abaixo deve **estender** essas
classes existentes (`servidor/nucleo/kernel/`), nunca duplicá-las com nome
novo — isso já é uma lição registrada no roadmap do projeto
("estender camadas existentes, nunca reconstruir").

## As oito frentes

Cada frente abaixo é um eixo de gate independente — ver seção "Gates
independentes" no final. Os itens são o que precisa ter evidência, não uma
lista de features para implementar às cegas.

**1. Gate de avaliação e liberação** — o veredito determinístico
(`Prova.ts`/`Verdade.ts` + skill `orquestrador`) realmente bloqueia liberação
sem bateria executada; campanha adversarial (`testes/campanha/`) obrigatória
antes de liberar; cenários sintéticos e mutantes em volume; taxa de
falso-completo por severidade; taxa de abstenção correta vs. incorreta; taxa
de recuperação; regressão por modelo/provedor; custo, latência e taxa de
sucesso; nenhum veredito `READY` com uma bateria crítica em `NOT_RUN`.

**2. Confiabilidade de execução** — checkpoint por operação; retomada após
crash; operação que fica `desconhecida` depois de perder a confirmação;
idempotência real, inclusive timeout depois do efeito já ter ocorrido;
deduplicação; travas intra-processo + interprocesso + distribuída onde for
necessário (`TravaAssincrona.ts` é o ponto de partida real); leases com
expiração; diário de recuperação (`RegistroOperacoes.ts` como candidato).

**3. Fronteira de segurança** — sandbox de verdade, não só checagem de
permissão (`PorteiroAutorizacao.ts`/`PoliticaRisco.ts`/`PortalEfeitos.ts`
como base real); processo separado para capacidade perigosa; allowlist de
filesystem; política de saída de rede; corretor de segredo (ver
`iara-fronteira-configuracao.md`: redação de segredo mora em
`SessaoOperador.enviar`); redação na entrada, contexto, log e saída; defesa
contra injeção de prompt em cadeia; teste de fuga de sandbox; teste de
exfiltração; teste de "confused deputy"; fuzzing dos parsers de ferramenta.

**4. Confiabilidade cognitiva** — reflexão e reparo; classificação da falha;
determinação de recuperabilidade; replanejamento (`Planejador.ts`,
`PlanosPropostos.ts`); execução (`FuncaoExecutiva.ts`); verificação
independente (nunca a mesma chamada que gerou a ação — ver `Investigacao.ts`,
`MotorAnalise.ts`, `Ambiguidade.ts`); limite de tentativas; prevenção de
recuperação que duplica efeito já aplicado.

**5. Memória e RAG** — procedência; TTL/expiração; versionamento; confiança;
correção explícita do operador; isolamento por `id_usuario` (já é invariante
documentado — auditar se `RagHistorico.ts`/`MemoriaOperacional.ts`/
`MemoriaFatos.ts`/`MemoriaTrabalho.ts`/`MemoriaDeSolucoes.ts`/
`TeoriaDaMente.ts` realmente cumprem isso sob concorrência); corpus
sintético; Recall@K; MRR; grounding; teste de poisoning; teste de vazamento
de ACL entre shards; teste de injeção de prompt via memória.

**6. Roteador de modelo** — não é só `Anthropic → Groq → Gemini → Ollama`; é
`tarefa → requisito → política → capacidade do modelo → custo → latência →
privacidade → disponibilidade → modelo`, com decisão explicável
deterministicamente. Base real: `ProvedorRaciocinio.ts`, `CadeiaDeRaciocinio.ts`,
`FabricaRaciocinio.ts`, `DiagnosticoProvedores.ts`.

**7. Operação de produção** — telemetria estruturada (`BarramentoEventos.ts`,
`Evento.ts`, `SondasDesempenho.ts`); métricas; traces; SLO; health/readiness/
liveness; alerta; canário; rollback; estratégia de migração; backup/restore
testado de verdade (não só existir script); recuperação de desastre;
limitação de taxa; cota; atualização segura.

**8. Robustez de produto** — instalação limpa em máquina nova; upgrade;
downgrade/rollback; configuração inicial; recuperação de credencial; perda de
internet; troca de computador; Windows Defender/antivírus; permissões do
Windows (o ambiente real é majoritariamente Windows); sleep/hibernação;
reinicialização; atualização do Ollama/modelos; múltiplas sessões
concorrentes (já é problema documentado — `iara-sessoes-concorrentes.md`);
celular ↔ PC (`Pareamento.ts`, `Braco.ts`); reconexão de WebSocket; PWA;
acessibilidade; onboarding; suporte/diagnóstico.

## Contrato por capacidade

Toda `CapacidadeAtiva`/`Habilidade` relevante precisa deste contrato — os
campos abaixo, não menos:

```
CAPACIDADE
├── Contrato (entrada/saída, quem chama, quem depende)
├── Pré-condições
├── Permissões
├── Classificação de risco
├── Schema de entrada
├── Schema de saída
├── Efeitos colaterais
├── Idempotência
├── Timeout
├── Política de retentativa
├── Verificação (independente de quem executou)
├── Rollback / recuperação
├── Trilha de auditoria
├── Orçamento de recurso
├── Fronteira de isolamento
├── Modos de falha
├── Testes adversariais
├── Testes de propriedade
├── Testes de fuzzing
├── Testes ponta a ponta
├── Observabilidade
└── Evidência de liberação
```

## Escada de maturidade — sem atalho de nível

```
IMPLEMENTADA
    ↓
VERIFICADA EM UNIDADE
    ↓
VERIFICADA EM INTEGRAÇÃO
    ↓
VERIFICADA ADVERSARIALMENTE
    ↓
VERIFICADA PONTA A PONTA
    ↓
VERIFICADA EM FALHA / RECUPERAÇÃO
    ↓
VERIFICADA EM DESEMPENHO
    ↓
VERIFICADA EM SEGURANÇA
    ↓
VERIFICADA EM RESISTÊNCIA
    ↓
VERIFICADA PARA LIBERAÇÃO
```

Uma capacidade não "pula" degrau porque parece simples. Se um degrau não foi
executado, o status para nesse degrau — não avança por suposição.

## Execução

Comece pelo inventário real do repositório — não pela implementação. Depois
construa a matriz:

```
CAPACIDADE × RISCO × TESTE × EVIDÊNCIA × STATUS
```

Não implemente tudo cegamente de uma vez. Primeiro encontre as maiores
lacunas (onde a matriz mostra `DESCONHECIDO` em risco alto). Depois ataque-as,
uma de cada vez:

1. implemente (ou estenda o kernel existente — nunca duplique);
2. teste;
3. registre evidência (arquivo, comando executado, saída);
4. faça commit atômico;
5. execute regressão completa;
6. atualize o veredito de sistema (a skill `orquestrador`, não um mecanismo
   paralelo).

## Entregável final

Ao final de cada ciclo, reporte:

**A.** o que realmente foi provado (com evidência citável)
**B.** o que foi falsificado (o que parecia certo e não era)
**C.** o que foi corrigido
**D.** o que ainda é `DESCONHECIDO`
**E.** o que impede produção agora
**F.** quais testes faltam
**G.** quais riscos residuais permanecem, mesmo depois da correção
**H.** qual é o próximo gate necessário

O objetivo não é produzir um relatório bonito. É tornar impossível declarar a
IARA pronta quando ela ainda não tem evidência de estar pronta.

## Gates independentes — não existe nota única

"Pronto para produção" não é uma nota. São oito gates independentes, um por
frente acima: **Avaliação × Confiabilidade de Execução × Segurança ×
Confiabilidade Cognitiva × Dados/Memória × Roteador de Modelo × Operação ×
Produto**. Se qualquer gate crítico estiver `DESCONHECIDO`, o sistema não
passa — mesmo que os outros sete estejam `VERIFICADA PARA LIBERAÇÃO`. A IARA
já tem uma versão inicial disso (veredito com cinco dimensões, nota = a
menor delas, no `orquestrador`) — o trabalho aqui é auditar se essas cinco
dimensões cobrem os oito eixos acima, e estender onde não cobrem, não
substituir o que já funciona.
