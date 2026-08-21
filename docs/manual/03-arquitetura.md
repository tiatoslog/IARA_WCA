## Arquitetura

### Onde as coisas vivem

```
iara-os/apps/web/
  lib/            contrato de domínio, compartilhado servidor e cliente
  servidor/       motor cognitivo
    nucleo/       estado, kernel, ações, RAG, teoria da mente, Claude
    barramento/   fila de telemetria e sessão WebSocket
    canais/       WhatsApp (Cloud API oficial da Meta)
  app/, components/, hooks/   camada de projeção (Next)
  dados/          base determinística e shards privados
  supabase/       schema.sql
```

### Duas projeções, um contrato

`SnapshotCognitivo` (`lib/snapshot.ts`) é a **única** coisa que atravessa a
fronteira do kernel. Duas projeções o consomem e nenhuma conhece o servidor:

- **Escritório** — a sala em pixel art. Lê `luzes` e `estagio`.
- **Presença** — a IARA em React Three Fiber. Lê `expressao`, `capacidades`,
  `plano` e `telemetria`.

Trocar de projeção não muda uma linha do servidor. Nenhum componente conhece
nome de morph target, pela mesma razão que nenhum conhece nome de arquivo de
sprite: a tradução mora em `components/projecao/mapaFacial.ts`.

### Os quatro problemas invisíveis, e onde estão resolvidos

**1. Dessincronização do laço de eventos.** O motor produz eventos em
microssegundos; o React desenha a 60 FPS. `barramento/SessaoOperador.ts`
aglutina micro-eventos e drena em janelas curtas — só marcos de transição sobem
para a sala. Fala é exceção: drena na hora, porque latência percebida é o
produto.

**2. Estouro de contexto por histórico de erros.** `nucleo/RagHistorico.ts`
nunca devolve log bruto — só hash, assinatura sintática de uma linha e a
resolução anotada pelo time. O log de dez mil linhas não existe na base, então
não há como injetá-lo.

**3. Contrapressão no WebSocket.** `barramento/FilaTelemetria.ts` é um anel de
100 pacotes com descarte semântico: pulsos e logs velhos são descartados; fala e
transição, nunca. Na reconexão vai o estado consolidado, não a enxurrada
retroativa — por isso o avatar não se teletransporta. O cliente ainda descarta
pacote com sequência menor que a última aplicada.

**4. Nomenclatura.** Domínio inteiro em português. Infraestrutura genérica pode
herdar nome de mercado (`WebSocket`, `AbortController`).

### Invariantes não negociáveis

- **A LLM não escreve estado.** Ela emite intenções estruturadas; o
  `EstadoAtomico` valida e aplica sob trava. Intenção inválida é descartada com
  log, nunca aplicada pela metade.
- **O RAG nunca injeta log bruto.**
- **Shards privados.** O caminho do shard é derivado do `id_usuario` da sessão. O
  operador nunca informa qual shard quer ler.
- **Presença não é informação.** Animação de ambiente nunca reage a dado;
  animação reativa só muda porque um campo do estado mudou. Misturar as duas faz
  a tela mentir.
- **Hierarquia espacial fixa:** Ambiente, Objetos, HUD, Conteúdo, Painéis. O
  escritório domina o campo visual; o painel de trabalho é a camada mais externa
  e recuada.
- **Nunca vermelho saturado.** Alerta é coral quente.

### Cancelamento preemptivo

Mensagem nova aborta o turno anterior no ato, inclusive um stream do Claude em
andamento. Nenhuma trava global é segurada durante chamada de rede — por isso o
cancelamento é instantâneo e a interface nunca congela.
