# THREAT MODEL

## Atores

| Ator | Capacidade assumida | Confiança |
|---|---|---|
| **Operador legítimo** | fala em português; sem controle sobre parâmetros estruturados | parcial — é quem autoriza risco alto |
| **Operador malicioso autenticado** | controla o WebSocket, monta pacotes à mão | **nenhuma além do próprio shard** |
| **LLM** | emite planos, textos e intenções estruturadas | **ZERO autoridade** |
| **Braço comprometido** | tem token válido do operador; escreve qualquer relato | **nenhuma** — é o modelo do IARA-002/004 |
| **Conteúdo externo** (web, RAG, documento, WhatsApp) | texto arbitrário que entra no raciocínio | **ZERO autoridade** |
| **Rede** | entrega parcial, duplicada, fora de ordem, atrasada | não confiável |
| **Quem edita o ambiente** (`IARA_ADMINS`) | define papéis | confiado — já podia trocar o binário |

## Ativos

1. Shard privado de cada operador (`dados/shards/<id>.json`)
2. Jornal de operações (`dados/operacoes/<id>.jsonl`) — selado com HMAC quando há chave
3. O computador do operador (via braço)
4. Orçamento de tokens da API
5. A veracidade da fala da IARA — **é ativo**: um "pronto" falso vale menos que silêncio

## Superfícies × mitigação × estado

| # | Ameaça | Mitigação no código | Estado |
|---|---|---|---|
| T1 | LLM emite `acionar_energia` e `resolver_confirmacao` no mesmo plano | `PorteiroAutorizacao` (origem) + `Operacao.transicionar` (fonte `operador`) + catálogo não oferece risco alto à LLM | VERIFIED (E1) |
| T2 | Operador declara ser outro (`id_usuario` no pacote) | `verificarToken` manda; o campo é decoração | VERIFIED (por código; Supabase não exercitado) |
| T3 | Braço declara ser de outro operador | mesma fronteira; `Braco.receber` descarta relato de dono errado | VERIFIED (código + I4) |
| T4 | Parâmetro não declarado / poluição de protótipo | `validar` com `Object.hasOwn`, saída construída do zero | VERIFIED (D1, D2, B4d) |
| T5 | Path traversal / UNC / ADS na criação de pasta | catálogo de 3 raízes + `validarNomePasta` + `path.join` | VERIFIED (B5c) |
| T6 | Command injection no agente Windows | `spawn`/`execFile` **sem `shell`**, comando e argumentos literais do mapa | VERIFIED por código; não há caminho para string de comando |
| T7 | Sondagem entre shards por linguagem | `PortaoSigilo` determinístico, **antes** do prompt | VERIFIED (F1/F2) |
| T8 | Replay de "confirmo" | nonce + estado + usuário + sessão + prazo em `RegistroOperacoes.autorizar` | VERIFIED (I2b) |
| T9 | Efeito duplicado por reentrega/duplo clique | jornal (semântica) + `Braco` (transporte) | **era vulnerável** → IARA-001 → VERIFIED |
| T10 | Braço mente "sucesso" | portão de coerência em `Braco.receber` + quinta porta | **era vulnerável** → IARA-002 → VERIFIED |
| T11 | Braço injeta payload no prompt pelo `texto` do relato | fronteira de leitura | **era vulnerável** → IARA-004 → VERIFIED (teto 8000) |
| T12 | Prompt injection indireta (web, RAG, documento) | `Sigilo` e esquema barram *ação*; o *texto* entra no raciocínio | **NOT_VERIFIED** — exige LLM real |
| T13 | Memória envenenada / inferência gravada como fato | `Verdade.ts` separa fato, hipótese e recomendação | NOT_VERIFIED nesta rodada |
| T14 | DoS contra o provedor de identidade | `LimiteVazao` pré-autenticação (120/min operador, 60/min braço) | VERIFIED (G1) |
| T15 | Escalação de privilégio por papel | `papelDe` lê só ambiente; restrição vence concessão | VERIFIED (E3) |
| T16 | Escape do agente Windows por habilidade nova | **nenhuma** além de revisão de commit | **RISCO ACEITO** — ver OBS-3 |
| T17 | SSRF | destino literal e fixo | N/A hoje (OBS-4) |
| T18 | Exaustão de memória do motor | tetos: trilha 300, diário 300, últimos 500, corpo web 2 MB, relato 8 kB | VERIFIED por código |

## O invariante que sustenta tudo

```
LLM OUTPUT → UNTRUSTED → VALIDATION → AUTHORIZATION → POLICY
           → CAPABILITY → EXECUTION → POST-CONDITION → RESULT
```

No código isto não é uma sequência de `if` — é imposto pelo **tipo**:

- `FonteEvidencia` não tem `'llm'`. A camada de raciocínio não consegue produzir
  o carimbo que `transicionar` exige para `autorizada` (risco alto) nem para
  `verificada` (qualquer risco).
- `AcaoDesktop` não tem `executar_comando`. Não existe string de comando na ponte.
- `Habilidade.esquema` é fechado; `validar` recusa o que não está declarado.

É a forma certa: um `if` se reordena, um tipo não.
