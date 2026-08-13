# SECURITY FINDINGS

Achados de segurança. Os defeitos com correção estão em `BUG_REGISTER.md`
(IARA-001 a IARA-007); aqui ficam as observações que **não** viraram conserto,
com a razão.

## Resumo

| Critério de NO-GO do protocolo | Resultado | Evidência |
|---|---|---|
| cross-tenant read/write | **0** | A4, A5, F1 (suíte existente), sonda I4 |
| privilege escalation | **0** | E3, `papelDe` lê só ambiente |
| unauthorized execution | **0** | E1/E2, `PorteiroAutorizacao`, `Operacao.transicionar` |
| replay execution | **0** | sonda I2b: replay, outro usuário, outra sessão, nonce errado — todos recusados |
| policy bypass | **0** | — |
| unverified SUCCESS | **2 encontrados → 0** | IARA-002 |
| critical fuzz crash | **0** | corpus de ~40 entradas; nenhuma exceção, nenhum laço |
| critical mutation survivor | **0 na mutação executada** | ver `MUTATION_TEST_RESULTS.md` |

## OBS-1 — o nonce da pendência de energia não está no caminho de autorização

- **Severidade**: informativa (não explorável hoje)
- **Onde**: `AgenteLocal.Pendencia.id`, `AgenteLocal.confirmar`

`Pendencia` carrega um `id: randomUUID()` documentado como "o nonce que dá à
pendência uma identidade própria, para que 'confirmo' nunca seja um cheque em
branco sobre o slot atual". Mas `confirmar(idUsuario, sessao)` não recebe id
algum: `valida()` confere expiração e sessão, e o `id` só aparece na linha de
auditoria.

O que de fato impede a troca silenciosa denunciada no comentário é a frase
`"Descartei o pedido anterior de …"`, emitida por `pedirEnergia` quando a ação
muda. Ela existe, é devolvida ao operador, e resolve o caso.

**Por que não foi corrigido**: acoplar o nonce exigiria carregá-lo até a fala do
operador ("confirmo") — que é texto livre e não carrega identificador. O
mecanismo equivalente e correto já existe uma camada acima, no
`RegistroOperacoes`, onde o nonce **é** exigido (`autorizar({nonce})`) e foi
validado nesta auditoria. Mudar `AgenteLocal` sem esse contexto criaria uma
terceira noção de autorização.

**Recomendação**: alinhar o comentário à realidade, ou migrar a pendência de
energia para o jornal, que já tem nonce, prazo, usuário e sessão.

## OBS-2 — `estado: 'sucesso'` não implica prova

- **Severidade**: informativa, de contrato
- **Onde**: `lib/execucao.ts`, `RelatoExecucao`

Depois do conserto do IARA-002, `sucesso` com `prova.confirmado: false`
continua possível — e deve continuar — quando `motivo === 'sem_meio_de_verificar'`.
É o caso legítimo do aplicativo que traz a janela existente para a frente, e da
plataforma sem `tasklist`.

Consequência: **`relato.estado === 'sucesso'` sozinho não é prova**. Hoje quem
lê esse campo cru é `Habilidade.executar` (`resolveu`), e a quinta porta corrige
o veredito lendo a prova. É uma segunda camada, não uma garantia de tipo.

**Recomendação**: quando houver refatoração da ponte, considerar separar
`sucesso` em `sucesso_provado` e `executado_sem_prova`, tornando impossível ler
o estado sem ler a prova.

## OBS-3 — não há sandbox de sistema operacional (Fase 15)

- **Severidade**: risco aceito, não defeito
- **Onde**: `servidor/nucleo/AgenteLocal.ts`, `servidor/braco/principal.ts`

A contenção do agente Windows é inteiramente **por allowlist em código**:

- catálogo fechado de sete ações (`AcaoDesktop`); não existe `executar_comando`;
- mapa fechado de aplicativos, com `comando` e `argumentos` literais;
- `spawn`/`execFile` **sem `shell: true`** em todos os pontos — não há
  interpretação de shell, logo não há command injection por parâmetro;
- três raízes nomeadas resolvidas de `homedir()`; o operador nunca informa path;
- `validarNomePasta` recusa travessia, separadores, `..`, ponto/espaço final e
  agora nomes de dispositivo;
- `execFile`/`spawn` confinados ao `AgenteLocal` por teste de fronteira
  (`fronteira-efeitos.test.ts`), verificado por grafo em
  `fronteira-interna.test.ts`.

O que **não** existe: Job Objects, restricted tokens, ACL própria, allowlist de
executáveis imposta pelo SO, isolamento de rede. O braço roda com o token do
usuário. A trava é revisão de commit.

**Isto não pode ser declarado "sandbox"** — e o protocolo é explícito sobre não
considerar sandbox existente só porque há uma abstração com esse nome. A classe
`Sandbox` em `Seguranca.ts` é um verificador de **permissões de papel**, não
isolamento de processo.

## OBS-4 — SSRF: não aplicável hoje, mas a superfície é uma linha

- **Onde**: `servidor/nucleo/BuscaWeb.ts`

`buscarNaWeb` monta `https://html.duckduckgo.com/html/?q=` + `encodeURIComponent`.
O host é literal; nenhum componente do operador alcança o host, a porta ou o
esquema. Os vetores da Fase 13 (`127.0.0.1`, `169.254.169.254`, IPv6, DNS
rebinding, representações alternativas) **não têm por onde entrar**.

Riscos remanescentes, aceitos:
- `fetch` segue redirecionamentos por padrão. O destino é um terceiro confiável;
  um redirecionamento para rede interna exigiria comprometimento do DuckDuckGo.
- **O texto devolvido é UNTRUSTED e alimenta o raciocínio** — é a superfície de
  prompt injection indireta da Fase 11, **não validada** nesta auditoria.

## OBS-5 — modo local não isola nada, por definição

- **Onde**: `servidor/nucleo/Autenticacao.ts` (`identidadeLocal`)

Sem Supabase, o `id_usuario` é o que o cliente digitar (canonizado por
`canonizarIdLocal`). É o comportamento declarado de desenvolvimento e o motor
avisa na interface. Não é defeito — é um modo cuja única proteção é não ser
exposto. Vale registrar porque **toda** conclusão de isolamento desta auditoria
pressupõe `autenticacaoAtiva() === true`.
