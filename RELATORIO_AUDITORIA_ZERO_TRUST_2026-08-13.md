# Auditoria zero-trust e verificação formal — IARA OS

**Data:** 13/08/2026
**Escopo:** `iara-os/apps/web` — motor cognitivo, barramento, canais, catálogo de habilidades e integrações
**Linha de base:** 451 testes (450 passando)
**Depois (ciclo 1):** 480 testes (479 passando) — 29 testes adversariais novos, 1 falha pré-existente não relacionada
**Depois (ciclo 2, seção 8):** 492 testes, 492 passando, `tsc --noEmit` limpo

---

## 0. A conclusão, antes do detalhe

O briefing pedia para "converter a arquitetura probabilística da IARA em uma
arquitetura híbrida garantida por invariantes determinísticas". **Essa conversão
já estava feita.** O sistema encontrado tem `PorteiroAutorizacao`,
`PoliticaRisco`, `PortalEfeitos`, `RegistroOperacoes`, `SandboxPorPolitica`,
`PortaoSigilo`, `Fronteira` com teste de grafo de chamadas e 451 testes. A LLM
já não escrevia estado, já não autorizava nada e já não era fonte de verdade.

Reescrever isso segundo o modelo do briefing teria substituído uma arquitetura
madura por uma genérica. O que esta auditoria fez foi **atacar a arquitetura
existente** e consertar o que cedeu.

Nove defeitos, três deles com consequência direta de segurança. Todos
corrigidos. **Veredito: GO condicionado** — as condições estão na seção 6.

---

## 1. O que já estava certo (e por isso não foi mexido)

Registrar isto importa tanto quanto listar falhas: são as travas que resistiram
ao ataque, e mexer nelas seria regressão.

| Invariante do briefing | Onde já vivia | Verificado por |
|---|---|---|
| LLM não executa, só nomeia | `MotorRaciocinio.interpretarPlano` — habilidade inventada invalida o plano inteiro | E1 |
| Risco alto exige fala humana | `PorteiroAutorizacao.avaliar` + `planejavel` (barreira dupla) | E1, E2 |
| Isolamento de shard não depende de prompt | `MemoriaOperacional` — `.eq('id_usuario')` obrigatório; nenhum método lê dois operadores | A1–A5 |
| Sondagem cruzada barrada por regra | `PortaoSigilo` — determinístico, fora do classificador de intenção | F1, F2 |
| Efeito só através de uma fronteira | `PortalEfeitos` + teste de grafo em `Fronteira.ts` | suíte existente |
| Aceite ≠ entrega | `Operacao` — `aceita_pelo_provedor` nunca vira `verificada` sem verificador | suíte existente |
| Fail-closed em produção | `principal.ts` recusa subir sem auth ou com curinga de origem | suíte existente |
| HMAC do webhook em tempo constante | `WhatsApp.iguais` → `timingSafeEqual` | suíte existente |
| Sem SSRF | `BuscaWeb` tem host fixo; sem parâmetro de URL em lugar nenhum | leitura |
| Separação de canal system/dado | `ClienteClaude.PERSONA` — cláusula pétrea de fronteira de confiança | leitura |

---

## 2. Vulnerabilidades encontradas × mitigações

### V1 — Jornal de operações sem integridade `[ALTA]`

**Classe:** OWASP LLM/Agentic — adulteração de trilha de auditoria
**Onde:** `RegistroOperacoes.reidratar`

O jornal em `dados/operacoes/*.jsonl` é a fonte da qual a IARA reconstrói,
depois de um restart, o que pode ter acontecido no mundo. A leitura era:

```ts
const op = JSON.parse(linha) as Operacao;   // ← a asserção mais cara do arquivo
ultimas.set(op.id_operacao, op);
```

Nenhuma validação. Três consequências, todas alcançáveis por qualquer coisa com
acesso de escrita ao volume:

1. Uma linha forjada com `estado: "verificada"` faz a IARA **jurar ter conferido
   um efeito que nunca aconteceu** — e some de `pendentesDeVerdade`, que é
   exatamente a lista que ela consulta antes de repetir algo.
2. Uma linha com `id_usuario` de **outra pessoa** entrava no índice compartilhado
   do processo (`porChave`, `operacoes`), envenenando a deduplicação e a lista de
   pendências de um terceiro. `reidratar(x)` lia `x.jsonl` e nunca conferia se o
   dono da linha era o dono do arquivo.
3. `estado` podia ser qualquer string.

**Mitigação** — `servidor/nucleo/kernel/Prova.ts` (novo) + `RegistroOperacoes`:

- toda linha gravada carrega um **HMAC-SHA256** sobre os campos do registro
  (lista de cobertura explícita, não "tudo menos o selo");
- a reidratação faz **validação estrutural** (formato, estado legal, dono ==
  arquivo) e depois **criptográfica**; o que não passa vai para quarentena e
  emite uma linha no canal `auditoria`;
- comparação de MAC em tempo constante, com prefixo de domínio (`jornal` vs
  `prova`) para que um selo nunca valha no lugar do outro.

**Limite declarado:** sem `IARA_CHAVE_PROVA` no ambiente não existe garantia
criptográfica — quem escreve o jornal escreve o selo. Nesse modo a validação
estrutural continua valendo (e já fecha o item 2 e o 3 acima), e o processo diz
isso na subida. Ver seção 6.

**Testes:** B1–B5, A4.

---

### V2 — Integrações sem contrato de parâmetros `[MÉDIA]`

**Classe:** Tool Execution Contract / Parameter Tampering
**Onde:** `PortalEfeitos.Integracao`, `integracoes/whatsapp.ts`

Habilidade tinha `esquema` e o `GerenciadorHabilidades` o impunha. **Integração
não tinha nada.** `whatsapp.responder` lia:

```ts
const telefone = String(pedido.parametros.telefone ?? '');
```

Qualquer chave, qualquer tipo, qualquer tamanho, direto para o `fetch` do Graph
da Meta. O comentário de `integracoes/index.ts` chegava a declarar que integração
"não tem esquema", como se fosse desenho.

**Mitigação:** `esquema` passou a ser campo **obrigatório** de `Integracao` — uma
integração nova não compila sem declarar o que aceita — e `PortalEfeitos.executar`
valida **antes** de reservar a operação. Os dois fixtures de teste que existiam
foram cobrados pelo compilador na hora, que é o comportamento desejado.

**Testes:** D6.

---

### V3 — `validar` deixava passar toda a família de nomes herdados `[MÉDIA]`

**Classe:** Parameter Tampering / poluição de protótipo
**Onde:** `Habilidade.validar`

```ts
if (!(chave in esquema)) throw new ParametroInvalido(...)
```

`in` caminha a cadeia de protótipos, e `esquema` é um objeto literal. Logo
`'__proto__' in esquema`, `'constructor' in esquema`, `'toString' in esquema` e
`'hasOwnProperty' in esquema` eram **todos verdadeiros**: a porta que existe para
recusar parâmetro não declarado deixava passar, calada, exatamente os nomes que
um payload de poluição de protótipo usa por definição.

Não era explorável hoje — o laço seguinte percorre `Object.entries(esquema)`, que
é só de propriedades próprias, então essas chaves nunca chegavam ao executor. Mas
uma trava que só não falha porque outra coisa a compensa já falhou; a compensação
some no dia em que alguém trocar aquele laço por um `for...in`.

**Encontrado pela suíte adversarial, não por leitura** (teste D1).

**Mitigação:** `Object.hasOwn(esquema, chave)`.

---

### V4 — Três canonicalizações divergentes do mesmo `id_usuario` `[MÉDIA, latente]`

**Classe:** Isolamento multi-locatário
**Onde:** `Autenticacao`, `MemoriaOperacional.idSeguro`, `RegistroOperacoes.arquivoDe`

| Função | Regra |
|---|---|
| `identidadeLocal` | minúsculas, remove fora de `[a-z0-9_-]`, corta em 48 |
| `MemoriaOperacional.idSeguro` | idem |
| `RegistroOperacoes.arquivoDe` | **preserva maiúsculas**, troca por `_`, corta em 64 |

As três **saneavam** em vez de recusar. Saneamento perde informação, e função que
perde informação mapeia identidades distintas no mesmo destino:

- `"Ana"` e `"ana"` → **um shard de memória**, dois jornais
- `"a b"` e `"a_b"` → **um jornal**, dois shards
- dois ids que só diferem depois do 48º caractere → um shard

Cada colisão é histórico de uma pessoa aparecendo para outra; cada divergência é
uma trava de idempotência que não fecha. **Nada disso dispara hoje** — o Supabase
emite uuid, que passa intacto pelas três. É o perfil de defeito que dorme até a
identidade passar a vir de outro provedor (e-mail, objectId, login de domínio), e
que aí não tem sintoma: só duas pessoas lendo o mesmo histórico.

**Mitigação:** `servidor/nucleo/kernel/Identidade.ts` (novo). Uma forma canônica,
`exigirIdCanonico` **recusa** em vez de consertar, e a única função que conserta é
a da fronteira do modo local — onde não há identidade a preservar. Mudança sem
efeito no comportamento atual, verificada em A2.

**Testes:** A1–A3.

---

### V5 — Vazamento de residentes / negação de serviço sem credencial `[MÉDIA]`

**Classe:** Recursos e concorrência
**Onde:** `barramento/Porta.ts`

`residenteDe()` inseria no mapa `residentes` e **ninguém removia nunca**. Cada
operador que conectasse uma vez deixava um `EstadoAtomico`, um
`BarramentoEventos` e um `Kernel` (com `MemoriaTrabalho`, `RegistroErros` e o
índice de habilidades dentro) vivos até o processo morrer.

Com autenticação ligada o crescimento tem teto no número de operadores reais e o
desperdício é discreto. Em modo local **não tem teto nenhum**: o `id_usuario` vem
de um campo que o cliente digita, e um laço de conexões com ids diferentes enche
a heap sem nenhuma credencial.

**Mitigação:** o residente sai do mapa quando a última tela fecha. Nada de
verdade se perde no descarte — o jornal é do processo, a memória está no shard, a
pendência de energia mora no `agenteLocal` (singleton).

---

### V6 — `ola` sem estrangulamento: amplificação contra o provedor de identidade `[MÉDIA]`

**Classe:** Recursos / DoS de terceiro
**Onde:** `barramento/Porta.ts`

`Kernel.processar` tem `LimiteVazao`, e ele protege bem o que vem **depois** da
identidade resolvida. O `ola` vinha antes: cada apresentação dispara um
`verificarToken`, que é chamada de rede ao Supabase, e a única guarda era
`if (operador || abrindo) return` — uma apresentação **por conexão**. Abrir mil
conexões é de graça: mil chamadas de autenticação sem uma credencial válida,
pagas pela cota de quem foi atacado.

**Mitigação:** janela deslizante global de 120 apresentações/minuto no processo,
com recusa **muda** (distinguir "excesso de tentativas" de "token inválido"
transformaria a porta num oráculo). Global e não por IP de propósito: atrás de um
proxy o IP visível é o do proxy, e uma janela por IP viraria uma janela por
infraestrutura inteira — pior que nenhuma, porque parece proteção.

---

### V7 — Planejador recebia material de terceiro sem moldura `[MÉDIA]`

**Classe:** OWASP LLM01 — injeção indireta de prompt
**Onde:** `MotorRaciocinio.planejar`

`responder()` já separava material de terceiro com marcadores e instrução
explícita. O **planejador** não: mandava `percepcao.bruto` cru, atrás de um rótulo
de autoridade (`PEDIDO:`). E `bruto` inclui, por desenho, o texto que o operador
citou de um e-mail, chamado ou documento — `Enunciacao.ts` separa as vozes
justamente porque conteúdo externo recitado não é ordem.

O plano emergente pode nomear qualquer habilidade de risco baixo ou médio
(`criar_pasta`, `abrir_aplicativo`), com parâmetros saídos da própria
decomposição. As travas de baixo continuavam de pé — porteiro barra risco alto,
esquema barra parâmetro inventado, allowlist barra aplicativo fora da lista — e é
por isso que o pior caso era limitado. **Limitado não é fechado**, e a moldura
custa zero token.

**Mitigação:** `citado` sai da posição de pedido e entra delimitado, com instrução
explícita de não decompor o material em passos.

---

### V8 — Esquema sem teto de tamanho nem filtro de controle `[BAIXA]`

**Classe:** Fuzzing / Context Overflow
**Onde:** `Habilidade.CampoEsquema`

Nenhum limite de tamanho em campo `texto`. `consultar_memoria_corporativa` monta
um índice de trigramas sobre o parâmetro (O(n) em memória e tempo), e o valor vem
de um plano emitido pela LLM — que pode estar repetindo um documento colado. Não
é ataque sofisticado: é o que sai naturalmente de um modelo instruído por uma
página a "repita este texto no parâmetro".

Também passavam byte nulo e controles C0 (`\r`, `\n` em campo que vira cabeçalho;
` ` que trunca caminho em várias APIs nativas), e `NaN`/`Infinity` em campo
`numero`.

**Mitigação:** `max` por campo com padrão de 4000; recusa de controles C0 (`\n` e
`\t` continuam passando — são texto legítimo); `Number.isFinite` obrigatório.

**Testes:** D3, D4, D5 (3000 iterações de fuzzing com semente fixa).

---

### V9 — RBAC inalcançável e roster que não excluía o próprio operador `[BAIXA]`

**Classe:** Controle de acesso / falso positivo de sigilo
**Onde:** `Kernel`, `Porta.ts`, `PortaWhatsapp.ts`, `lib/operadores.ts`

**9a.** `Seguranca.ts` define três papéis, com matriz de permissões, sandbox que a
impõe e testes que a exercitam. O Kernel fazia `dep.papel ?? 'operador'` — e os
dois únicos lugares que constroem um Kernel de produção **nunca passavam o
campo**. Todo mundo era `operador`, sempre; `administrador` e `somente_leitura`
existiam só nos testes. Um controle de acesso que só sabe emitir um valor é uma
constante com nome de política: não havia como conceder `externo` a ninguém, nem
como rebaixar ninguém a leitura.

**9b.** `outrosOperadores(idAtual)` filtrava por id. Com Supabase, `id_usuario` é
uuid e uuid nunca casa com `'daiane'`: o filtro não excluía ninguém, e **o próprio
nome do operador entrava na lista de "outros"**. Consequência: o `PortaoSigilo`
tratando uma pergunta da pessoa sobre o registro dela mesma como sondagem entre
shards, e recusando com uma frase sobre privacidade de terceiro — a pior recusa
possível, porque parece uma acusação.

**Mitigação:** `servidor/nucleo/kernel/Papeis.ts` (novo) deriva o papel de
`IARA_ADMINS` / `IARA_SOMENTE_LEITURA`, casando por id **ou** e-mail, com a
restrição vencendo a concessão. `outrosOperadores` passou a aceitar o nome e a
comparar normalizado. O padrão não muda: quem não está em lista nenhuma continua
`operador`.

**Testes:** E3, A5.

---

## 3. A prova determinística (Fase 2 do briefing)

O briefing pediu um *Proof Token* por ação de alto risco. Ele existe em
`servidor/nucleo/kernel/Prova.ts`, no vocabulário do projeto:

| Campo do briefing | Campo implementado |
|---|---|
| `action_id` | `id_acao` — o `id_operacao` do jornal |
| `intent_hash` | `hash_intencao` — SHA-256 do enunciado do operador |
| `extracted_params` | `parametros` — os **já validados** contra o esquema |
| `auth_claims` | `reivindicacoes` — `id_usuario`, `sessao`, `papel`, `escopo` |
| `policy_evaluation` | `avaliacao` — `permitido`, `politica`, `risco`, `fonte_autorizacao` |
| `invariant_checks` | `invariantes` — cinco, todas obrigatórias |
| `deterministic_verifier_sig` | `assinatura` — HMAC-SHA256 |

**A regra `Status ≠ VERIFIED_PROOF ⟹ ABORT` não é um `if`.** `emitirProva` lança
quando falta invariante, e é chamada **dentro** do caminho de execução do
`PortalEfeitos.abrir`, antes do carimbo de `autorizada`. Um caminho de efeito novo
não consegue autorizar nada sem emitir a prova primeiro — não há onde esquecer de
escrever a checagem.

As cinco invariantes e quem as atesta:

| Invariante | Atestada por | Como |
|---|---|---|
| `SEMANTICA_DECLARADA` | portal | `podeExecutar` recusou `efeito_desconhecido` |
| `AUTORIZACAO_TIPADA` | portal | `fonte_autorizacao` é tipo fechado; `transicionar` recusa `porteiro` em risco alto |
| `ISOLAMENTO_SHARD` | portal | dono é o da operação reservada, nunca um campo do pedido |
| `ORIGEM_RASTREAVEL` | portal | `origem_pedido` presente |
| `PARAMETROS_VALIDADOS` | **chamador** | Kernel/portal rodaram `validar` sobre exatamente estes parâmetros |

Uma **correção de ordem** veio junto: o Kernel abria a operação no jornal *antes*
de qualquer validação, então a chave de idempotência e a linha de auditoria
nasciam de parâmetros que ninguém tinha olhado — e dois pedidos que só diferissem
num campo inexistente produziam chaves **diferentes** para o mesmo efeito real.
Agora valida-se primeiro.

A prova sai no canal `auditoria` como uma linha JSON. **`parametros` não vai no
log** — eles já estão no jornal, que é o lugar deles; copiá-los para o console os
espalharia para todo mundo que lê log. A `assinatura` amarra as duas pontas.

---

## 4. Suíte adversarial (Fase 4)

`iara-os/apps/web/testes/zero-trust-adversarial.test.ts` — 29 testes, todos
passando. Nenhum deles mocka uma trava: um teste de segurança que mocka a trava
mede a própria fixture.

| Grupo | Testes | O que ataca |
|---|---|---|
| A. Isolamento multi-locatário | 5 | colisão de identificador, travessia de caminho, linha de outro dono no jornal, roster com uuid |
| B. Integridade do jornal | 5 | promoção forjada a `verificada`, adulteração de dono, estado inexistente, ausência de chave |
| C. Prova determinística | 5 | invariante faltando, política recusada, assinatura adulterada, estabilidade da canonicalização |
| D. Contrato de ferramenta | 7 | `is_admin`/`role`/`user_id`/`price`/`__proto__`, payload gigante, byte nulo, `NaN`, **3000 iterações de fuzzing com semente fixa**, provedor que explode |
| E. Agência excessiva | 3 | plano emergente tentando risco alto, catálogo oferecido à LLM, RBAC contraditório |
| F. Injeção e sondagem | 3 | injeção direta de prompt, falso positivo de sigilo, pacote malformado no socket |
| G. Vazão | 1 | janela deslizante |

Dois pontos sobre a suíte:

- **O fuzzer tem semente fixa (20260813).** Um fuzzer sem semente que acha um
  defeito hoje e passa amanhã é pior que nenhum — ele treina a equipe a apertar
  "rodar de novo".
- **A suíte encontrou um defeito no próprio arnês** antes de encontrar V3: o
  helper `comChave` fazia `return corpo()` com corpo `async`, restaurando a
  variável de ambiente **antes** de o trabalho acontecer. Dois testes mediam o
  comportamento sem chave enquanto afirmavam medir o comportamento com chave — e
  passavam a impressão oposta da verdade, que é o pior defeito que um teste de
  segurança pode ter. Corrigido e comentado no arquivo.

---

## 5. O que NÃO foi feito, e por quê

Registrar isto é parte do trabalho.

- **Distributed locking (Redis Redlock).** O briefing pediu; o sistema é
  monoprocesso por desenho e `TravaAssincrona` + `RegistroOperacoes.reservar`
  (síncrono) já fecham a janela `ler → await → escrever` dentro dele. O limite
  real está declarado no próprio código: a garantia é "no máximo uma vez **por
  processo**", não "exatamente uma vez". Duas instâncias do motor contra o mesmo
  `dados/` **não** são cobertas. Isso vira problema no dia em que houver mais de
  uma réplica — e aí a resposta é uma trava no banco, não Redis a mais.
- **Papel vindo do Supabase.** `Papeis.ts` lê do ambiente. Uma coluna no banco é
  melhor e é para onde isto deve ir, mas exige migração de schema, tela de
  administração e caminho de escrita novo — três superfícies novas. O ambiente já
  é a fronteira de confiança do processo: quem edita `IARA_ADMINS` no host já
  podia trocar o binário. O dia da migração troca só uma função.
- **Rotação de `IARA_CHAVE_PROVA`.** Trocar a chave invalida os jornais
  anteriores (eles passam a cair na quarentena). Um esquema de duas chaves
  (`atual` + `anterior`) resolveria; não foi feito porque a chave ainda não existe
  em produção e projetar rotação antes do primeiro uso é adivinhação.
- **Falha-fechada na ausência da chave de prova.** O `principal.ts` **avisa** em
  vez de recusar subir. As duas falhas-fechadas que já existem recusam porque sem
  elas o sistema fica **aberto**; esta é de outra natureza — perde-se integridade
  da trilha de auditoria, não controle de acesso. Derrubar um deploy em produção
  por isso trocaria um risco de forense por um risco de disponibilidade, sem
  consultar quem opera.

---

## 6. Veredito: **GO condicionado**

### Evidência

- `tsc --noEmit` limpo.
- 480 testes, 479 passando.
- 29 testes adversariais novos, todos passando, sem mock de trava.
- 3000 iterações de fuzzing de propriedade sobre o validador de contrato, com
  semente fixa: nenhuma exceção fora de `ParametroInvalido`, nenhuma chave não
  declarada na saída.

### As três condições

1. **Definir `IARA_CHAVE_PROVA` no host antes do próximo deploy.** Sem ela a
   trilha de auditoria é validada só por estrutura — quem escrever no disco
   consegue inserir uma operação `verificada` que nunca existiu. Geração e
   documentação estão em `.env.example`. Verifique na subida: o processo imprime
   `jornal de operações: selado` ou `SEM SELO`.

2. **Consertar o teste que falha antes de fazer merge.**
   `testes/agenda.test.ts` — *"o assunto sai limpo do ruído temporal"* espera
   `"ligar para o Índio"` e recebe `"de ligar para o Índio"`. É trabalho seu em
   andamento (`Agenda.ts` e `Quando.ts` são arquivos novos não versionados), não
   tem relação com segurança e **já falhava antes desta auditoria** — mas
   `npm run verificar` sai com código 1 enquanto ela estiver lá, e um pipeline
   vermelho por um motivo conhecido é como se aprende a ignorar pipeline
   vermelho.

3. **Decidir os papéis.** `IARA_ADMINS` vazio significa que ninguém tem a
   permissão `externo` — nenhum envio de WhatsApp pelo catálogo funciona. Isso é
   o padrão seguro e pode ser exatamente o que você quer; só não pode ser
   descoberto no dia em que alguém pedir um envio.

### O que muda em produção quando isto subir

Nada quebra por padrão. Todas as mudanças de comportamento são fechamentos:
parâmetro não declarado passa a ser recusado onde antes era ignorado, id não
canônico passa a ser recusado onde antes era mutilado (e nenhum id que o sistema
emite hoje é não canônico), e o jornal ganha um campo `selo` que versões
anteriores simplesmente ignorariam.

**Uma exceção a vigiar:** jornais gravados **antes** desta mudança não têm selo.
Com `IARA_CHAVE_PROVA` ativa, eles caem na quarentena na primeira reidratação e
aparecem como `jornal_linha_recusada` no canal de auditoria. É o comportamento
correto — o sistema não tem como distinguir "escrito por uma versão antiga" de
"escrito por outra pessoa" — mas vale saber antes de ver o log.

---

## 7. Arquivos

**Novos**

```
servidor/nucleo/kernel/Prova.ts          selo do jornal + prova determinística
servidor/nucleo/kernel/Identidade.ts     forma canônica de id_usuario, num lugar só
servidor/nucleo/kernel/Papeis.ts         papel efetivo da sessão (RBAC alcançável)
testes/zero-trust-adversarial.test.ts    29 testes adversariais
```

**Alterados por esta auditoria**

```
servidor/nucleo/kernel/RegistroOperacoes.ts   validação estrutural + criptográfica na reidratação
servidor/nucleo/kernel/PortalEfeitos.ts       esquema obrigatório em integração; emissão da prova
servidor/nucleo/kernel/Habilidade.ts          hasOwn, max, controles C0, número finito
servidor/nucleo/kernel/Kernel.ts              validar antes de abrir a operação; reivindicações
servidor/nucleo/kernel/GerenciadorHabilidades.ts  validarParametros público
servidor/nucleo/kernel/MotorRaciocinio.ts     moldura de material de terceiro no planejador
servidor/nucleo/kernel/integracoes/whatsapp.ts    contrato de parâmetros
servidor/nucleo/MemoriaOperacional.ts         idSeguro recusa em vez de sanear
servidor/nucleo/Autenticacao.ts               canonicalização única na fronteira local
servidor/barramento/Porta.ts                  descarte de residente; estrangulamento pré-auth; papel
servidor/canais/PortaWhatsapp.ts              papel; nome do operador para o portão de sigilo
servidor/principal.ts                         diagnóstico do selo na subida
lib/operadores.ts                             exclusão do próprio operador por nome
.env.example                                  IARA_CHAVE_PROVA, IARA_ADMINS, IARA_SOMENTE_LEITURA
testes/fronteira-efeitos.test.ts              fixture com esquema (cobrada pelo compilador)
scripts/prova-encerramento-escrita.ts         idem
```

Os demais arquivos modificados na árvore (`Agenda.ts`, `Quando.ts`,
`habilidades/agenda.ts`, `Percepcao.ts`, `Planejador.ts`, `AgenteLocal.ts`,
`CicloAutonomo.ts`, `schema.sql`, `agente-local.test.ts`, `agenda.test.ts`) já
estavam modificados quando esta auditoria começou e **não foram tocados** — são a
sua feature de lembretes em andamento.

---

## 8. Ciclo 2 — o defeito que a condição 2 escondia, e as oito propriedades formalizadas

Este ciclo partiu do veredito anterior (GO condicionado a três coisas) e do
requisito acrescentado depois dele: *"não precisamos provar que o LLM nunca
erra; precisamos provar que um erro do LLM não consegue violar nenhuma
propriedade crítica"*. Duas frentes, na ordem em que foram executadas.

### 8.1 Condição 2 fechada — e a família inteira que estava atrás dela

A falha era um `assert` só, e parecia cosmética: `extrairAssuntoLembrete`
devolvia `"de ligar para o Índio"` onde o teste esperava `"ligar para o Índio"`.
A regra 60 do briefing (procurar a família, não o caso) mudou o resultado.
Sondando dezesseis frases reais contra a função **antes** de tocar em qualquer
linha:

```
"me lembre em 20 minutos de ligar para o Índio"  -> "de ligar para o Índio"
"me lembre amanhã da reunião de pauta"           -> "amanhã da reunião de pauta"
"me lembre às 15h de ligar para o cliente"       -> "às de ligar para o cliente"
"me lembre de ligar para o cliente às 14h"       -> "ligar para o cliente às"
"me lembre às 8 da noite de fechar o caixa"      -> "às 8 da noite de fechar o caixa"
"me lembre às 15h"                               -> "às"
```

**Causa-raiz, e ela é arquitetural, não de regex.** O módulo normaliza para
*interpretar* (`normalizar`, que tira acento) mas tentava recortar sobre o texto
*original*, com acento. `amanha` nunca casa `amanhã`; `as` nunca casa `às`. O
contrato era impossível — e o cabeçalho do arquivo racionalizava o resíduo como
decisão deliberada ("sobrar um `amanhã` no assunto é feio"). Não era feio: era o
caminho pelo qual `"me lembre às 15h"` produzia um lembrete cujo **assunto é
`"às"`** — dois caracteres, portanto acima do piso que existe justamente para
disparar a pergunta ao operador. A recusa declarada do módulo ("hora sem assunto
devolve vazio, e a habilidade pergunta") era contornada pelo próprio defeito, e a
IARA anunciava `Marcado: às — hoje às 15:00` com a mesma confiança de um lembrete
real. Na taxonomia do briefing: A (parâmetro errado) virando G (falsa impressão
de conclusão).

**Correção.** `projetar()` constrói uma *sombra* sem acento do texto com os
índices alinhados um a um; o casamento acontece na sombra e o recorte é aplicado
no original. O conectivo órfão (`de`, `da`, `que`) passou a ser removido **depois**
da retirada do ruído temporal — a ordem invertida era a causa do defeito
reportado. O ramo de relógio passou a consumir o `h` que sobrava.

**Teste antes / teste depois.** Os onze casos da família viraram tabela, mais uma
propriedade que gera dezoito frases (nove marcas de tempo × antes/depois do
assunto) e afirma que nenhum assunto extraído contém dígito, `amanh`, `hoje`,
`meio` ou `as` isolado — e que o acento de `Índio` sobrevive a todas. Suíte de
agenda: 21 → 23 testes, verdes.

### 8.2 As oito propriedades críticas, declaradas e provadas

O briefing pedia invariantes formais, verificação independente do gerador e
fail-closed. Elas existiam no código, espalhadas por seis módulos e provadas de
lado em vinte e oito suítes. O que faltava era a **amarração**: nenhuma lista
dizia quais propriedades são críticas, quem as impõe, e qual teste prova cada
uma. Sem isso, `NOT PROVEN` e `PASS` eram indistinguíveis.

**`servidor/nucleo/kernel/Invariantes.ts`** declara as oito, cada uma com o
enunciado na forma antecedente ⟹ consequente, a formulação original do briefing,
os pontos de imposição (arquivo + símbolo) e o que uma violação permitiria em
termos operacionais. O módulo **não decide nada em tempo de execução** — quem
barra continua sendo `transicionar`, `SandboxPorPolitica`, `PorteiroAutorizacao`,
`validar`, `emitirProva` e a derivação de shard. Um segundo lugar que decide
seria política em dois lugares, e política em dois lugares é política em nenhum.

| ID | Propriedade | Imposta por |
|----|-------------|-------------|
| P1 | ação não autorizada nunca executa | `SandboxPorPolitica`, `PorteiroAutorizacao` |
| P2 | ferramenta que falhou nunca vira sucesso | `PortalEfeitos.executar`, `EvidenciaInsuficiente` |
| P3 | ação cancelada nunca executa | `TRANSICOES`, `RegistroOperacoes.autorizar` |
| P4 | shard alheio nunca é alcançado | `lerLinhaDoJornal`, `exigirIdCanonico` |
| P5 | o dono do efeito nunca vem do pedido | `criarOperacao`, `validar` |
| P6 | fato desconhecido nunca vira verificado | `transicionar`, `emitirProva`, `conferirRegistro` |
| P7 | plano emergente nunca executa risco alto | `PorteiroAutorizacao.planejavel` |
| P8 | ação irreversível exige fala humana | `transicionar`, `PoliticaRisco.exigenciaDe` |

**`testes/propriedades-criticas.test.ts`** (11 testes) exercita cada ponto de
imposição contra o módulo real — nenhuma trava é mockada — e mantém um livro-caixa
de cobertura. Os três testes finais falham se sobrar propriedade declarada sem
prova executada, se um símbolo citado no registro sumir do código, ou se alguém
registrar cobertura com um nome que a propriedade não declara. É o que impede o
registro de virar documentação que envelhece em silêncio, que foi exatamente o
defeito de V1.

**P5 e a honestidade sobre locatário.** O briefing pede `TENANT_A → NEVER ACCESS
TENANT_B_DATA`. Não existe entidade "locatário" neste código: existe operador, e
o shard do operador é a única fronteira de dados. A propriedade foi declarada com
esse limite escrito no lugar onde alguém vai lê-lo. Chamar o que existe de
isolamento multi-locatário seria prometer separação de banco, chave e backup que
não existe.

### 8.3 Os testes têm dentes — prova por mutação

Uma suíte que passa de primeira não é evidência de nada: pode estar medindo a
própria fixture. Cinco mutações foram aplicadas ao código de produção, uma de
cada vez, com a suíte rodando entre elas e o arquivo restaurado em seguida:

| Mutação | Resultado |
|---------|-----------|
| `transicionar` perde a trava de risco alto | **detectada** |
| `TRANSICOES.cancelada` volta a permitir `autorizada` | **detectada** |
| `lerLinhaDoJornal` deixa de conferir o dono | **detectada** |
| registro cita um ponto de imposição que não existe | **detectada** |
| `PorteiroAutorizacao` libera plano emergente | **detectada** |

### 8.4 Re-varredura completa

`npm run verificar` (GLSL + `tsc --noEmit` + suíte inteira), do zero, depois de
todas as correções:

```
tsc --noEmit   sem erros
tests 492  |  pass 492  |  fail 0
```

Linha de base deste ciclo: 480 testes, 479 passando. Depois: **492 testes, 492
passando**. Nenhum teste foi removido, afrouxado ou marcado como pendente.

### 8.5 Veredito atualizado

**GO condicionado a duas coisas** — a terceira foi fechada aqui.

1. **`IARA_CHAVE_PROVA` no host, antes do próximo deploy.** Sem ela o sistema
   roda e diz em voz alta que roda sem garantia criptográfica; a trilha de
   auditoria é só estrutural. Ver a seção 5 para por que a ausência não derruba
   a subida.
2. **Decidir `IARA_ADMINS`.** Vazio significa que ninguém tem `externo` — nenhum
   envio de WhatsApp pelo catálogo funciona. É seguro por construção e
   provavelmente não é o que você quer.
3. ~~Consertar `testes/agenda.test.ts`~~ — **fechado na seção 8.1**, junto com a
   família de sete defeitos irmãos que o `assert` vermelho escondia.

**Risco residual, inalterado:** o limite monoprocesso da trava de idempotência
(seção 5), a falha-aberta na ausência da chave de prova (seção 5), e os jornais
gravados antes do selo, que entram em quarentena na primeira reidratação com a
chave ativa e aparecem como `jornal_linha_recusada` no log.

**Incertezas explícitas (`UNKNOWN`), e elas não mudaram:** o comportamento sob
concorrência multiprocesso não foi medido porque o sistema não roda
multiprocesso hoje; a qualidade semântica das respostas da LLM continua não
sendo objeto de prova — o que este ciclo prova é que um erro dela não atravessa
P1–P8.

A IARA atingiu os critérios definidos de verificação, dentro do escopo testado,
com as limitações explicitamente documentadas.

### 8.6 Arquivos do ciclo 2

**Novos**

```
servidor/nucleo/kernel/Invariantes.ts        registro formal das oito propriedades críticas
testes/propriedades-criticas.test.ts         11 testes; prova executável + livro-caixa de cobertura
```

**Alterados**

```
servidor/nucleo/kernel/Quando.ts             sombra com índices alinhados; ordem do recorte corrigida
testes/agenda.test.ts                        família de 11 casos + propriedade sobre resíduo temporal
```
