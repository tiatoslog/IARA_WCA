## Visão geral

A IARA é a inteligência corporativa residente da Atos Log: um mordomo digital
que atende até cinco operadores, com isolamento de memória entre eles, e que
projeta o próprio trabalho numa sala em pixel art.

O produto **não é um dashboard**. É um escritório. A diferença não é estética —
é o critério que decide toda adição futura: ao propor qualquer elemento novo, a
pergunta é *"que objeto da sala é isto?"*, nunca *"que componente de dashboard
preciso?"*.

### O que a torna diferente de um chat com LLM

**Cerca de 80% das perguntas operacionais nunca chegam ao modelo.** Camadas mais
baratas decidem antes:

| Camada | Onde decide | Latência | Custo |
|---|---|---|---|
| Roteador semântico | percepção e planejador determinístico | microssegundos | zero |
| Ações nativas | `OrquestradorAcoes` | 1–8 ms local, cerca de 1,1 s com rede | zero |
| RAG schema-only | `RagHistorico` | cerca de 4 ms | zero |
| Raciocínio (Claude) | `ClienteClaude` | streaming | tokens |

**Transparência espacial.** Quando um assistente comum processa, aparece uma
borda genérica brilhando. Aqui, o objeto que está trabalhando é o objeto que
acende: ação local acende o terminal, busca histórica acende a estante, clima
acende a janela, raciocínio pesado põe o rack em pulsação. O evento visual é
emitido *antes* de o trabalho começar — é isso que elimina a sensação de
travamento.

**A interface nunca inventa vida.** Todo evento visual nasce de um fato
observado no laço do agente. Se um objeto acende, é porque a capacidade
correspondente está em uso agora.

### Sem chave da Anthropic, o sistema funciona

Sem `ANTHROPIC_API_KEY` a IARA roda completa em modo local — clima,
infraestrutura, histórico de incidentes, hora, busca web — e **avisa isso na
interface** em vez de improvisar resposta. É decisão de produto, não degradação:
um assistente que inventa quando não sabe é pior que um que se cala.
