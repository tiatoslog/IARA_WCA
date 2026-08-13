# IARA — AUDITORIA FINAL

**Data:** 13/08/2026 · **Modo:** autônomo, zero-trust
**Árvore:** `IARA_WCA`, branch `pareamento-e-instalador`, HEAD `24f5d4c`

---

## EXECUTIVE SUMMARY

**Status: NO-GO para push.**

O motivo não é qualidade do trabalho auditado — é **procedência**. A árvore de
trabalho contém alterações não commitadas de **pelo menos três autores
diferentes**, e uma delas quebra a suíte. Publicar em `main` significaria
publicar trabalho de terceiro que eu não revisei, não entendi e não posso
atribuir.

A cláusula §31 da missão ("NÃO sobrescreva trabalho existente sem entender sua
origem") e a §4 ("processos concorrentes") descrevem exatamente esta situação.
O que eu podia fazer sem publicar, fiz e provei.

---

## BASELINE

| | |
|---|---|
| Commit inicial da sessão | `afb8040` |
| Commits publicados por mim | `9ddf899`, `9ce3106` (ambos em `origin/main`) |
| Commit da sessão paralela | `24f5d4c` (branch, **não** em `main`) |
| HEAD atual | `24f5d4c` + trabalho não commitado |
| `origin/main` | `9ce3106` |

Baseline medido **antes** de eu editar qualquer coisa nesta rodada:

```
npx tsc --noEmit   → limpo
npm test           → 693 testes, 693 pass, 0 fail
```

---

## O BLOQUEIO (o achado que decide o veredito)

`servidor/nucleo/AgenteLocal.ts` contém, num único arquivo não commitado:

1. ~250 linhas minhas (`atualizarRepositorio`, executor de git, allowlist);
2. uma edição de terceiro na frase de `fecharAplicativo`
   (`"continua aberto"` → `"o processo continua na máquina"`).

A edição (2) **quebra o teste F7** de `ponte-execucao.test.ts`, que afirma
`/continua aberto/i`.

Além dela, estão modificados sem commit e sem autoria conhecida:
`MotorRaciocinio.ts`, `ClienteClaude.ts`, `BuscaWeb.ts`, `MemoriaOperacional.ts`,
`GerenciadorHabilidades.ts`, `Agenda.ts`, `ClienteSupabase.ts`, `Porta.ts`, mais
`scripts/_probe-busca.ts` e `scripts/_probe-degradacao.ts` (não rastreados).

**Não classifiquei a edição (2) como defeito.** A frase nova é mais honesta que a
antiga — a antiga afirmava a causa ("normalmente acontece quando há algo não
salvo") que o programa não tem como saber. O problema não é o texto; é que ele
chegou aqui sem commit, sem teste atualizado e sem dono identificável. Corrigir o
teste para casar com ele seria eu assinar uma mudança que não é minha.

**Não revertí nada de terceiro.** Reverter destruiria trabalho em voo. A árvore
ficou consistente e intacta.

---

## BUGS

### P1 — corrigido e provado

**Pareamento: código já aprovado respondia `ok: true` para outro operador.**
`RegistroPareamento.aprovar` devolvia sucesso para qualquer operador que
mandasse um código já aprovado, sem conferir quem o aprovara.

Reproduzido antes de consertar:

```
1) Ana aprova .............. {"ok":true,"nome":"PC-DA-ANA"}
2) BRUNO manda o MESMO cod . {"ok":true,"nome":"PC-DA-ANA"}
   credenciais gravadas .... ["u-ana"]
   dispositivos do Bruno ... 0
```

Dois danos, nenhum deles vazamento de credencial (o token exige a chave, que o
intruso não tem):

- **falso sucesso** — a tela do Bruno diria "PC-DA-ANA conectado" com a lista de
  dispositivos dele vazia;
- **oráculo entre operadores** — ele confirmava que o código existia e aprendia o
  nome do computador alheio, **sem pagar cota**, porque a janela de erro só é
  consumida quando o código não é encontrado.

Correção: quem não é o dono recebe a frase e a cota do código errado —
indistinguível, pela mesma disciplina de `verificarToken`.

**Verificação por mutação:** trocando a condição por `if (false)`, o teste de
regressão falha (`not ok 22`). O teste detecta o defeito; não é decorativo.

### P2 — corrigido e provado

**Mobile: a gema não aparecia no ícone.** Causa: aritmética de enquadramento, não
render. A pedra ocupa `1/(distância × tan(abertura/2))` da altura — em 18,5 isso
é 0,25, e um quarto de 56px são 14px de cromo escuro sobre fundo escuro. Ela
estava sendo desenhada o tempo todo, do tamanho de um caractere.

Correção: distância de ícone (6,2 → ~0,76 da altura), derivada do **tamanho real
do canvas**, nunca da intenção do React.

**Um segundo defeito foi encontrado e corrigido antes de sair daqui:** a primeira
versão recebia `recolhida` por propriedade — e no computador esse estado nasce
`true`, porque quem decide se ele vale é a consulta de mídia do CSS. Teria
aplicado a câmera de ícone num palco de 900px. Há teste para esse caso.

### Não corrigido — sem dono

**F7 (`ponte-execucao.test.ts`) falhando** por edição de terceiro não commitada.
Ver O BLOQUEIO.

---

## CAPABILITIES

| Capability | Status | Prova |
|---|---|---|
| `criar_pasta` | VERIFIED | suíte existente + correção do nome (7 frases reais) |
| `atualizar_repositorio` (git pull) | **VERIFIED (unit)** / UNVERIFIED (real) | 11 testes com executor espião; **nunca exercitado contra um repositório de verdade** |
| Pareamento por código | PARTIALLY_VERIFIED | 23 testes + rotas HTTP exercitadas pela sessão paralela |
| Pareamento por **QR** | **NOT_IMPLEMENTED** | o código é digitado, não escaneado |
| Voz (latência) | UNVERIFIED | instrumentada, **nunca medida** — nenhum turno real rodou |
| Ícone da gema no celular | PARTIALLY_VERIFIED | aritmética provada; **render nunca visto** |
| Leitura de sessões do Claude | NOT_IMPLEMENTED | desenho em `LEITURA_DO_CLAUDE.md` |
| `git push` | NOT_IMPLEMENTED | decisão da operadora: só puxar |

---

## O QUE NÃO PUDE VERIFICAR

Listado sem eufemismo, porque é o que a §40 exige:

1. **Nenhum render foi visto.** A tela exige login e eu não uso credencial de
   ninguém. Toda a correção do mobile é provada por aritmética e geometria
   medida no navegador — não por olhar a gema.
2. **O `git pull` nunca puxou nada.** Os 11 testes usam executor espião. O
   comportamento contra um repositório real, com rede real, é UNKNOWN.
3. **A voz nunca foi medida.** A instrumentação está publicada; os números só
   existem depois de um turno real.
4. **O QR não existe.** A sessão paralela entregou código digitado e declarou a
   lacuna. Não a classifiquei como escopo futuro: é o que foi pedido e não foi
   entregue.
5. **Concorrência, fuzzing, fault injection e mutation testing além do caso do
   pareamento: NÃO EXECUTADOS.** A missão os pede; eu não os rodei. Declarar
   "passou" seria mentira.
6. **CI:** não verificado. `gh` não está autenticado nesta máquina.

---

## GIT

| | |
|---|---|
| Branch | `pareamento-e-instalador` |
| HEAD | `24f5d4c` |
| `origin/main` | `9ce3106` |
| Push nesta rodada | **NÃO REALIZADO** |
| Trabalho meu commitado nesta rodada | **NÃO** — ver O BLOQUEIO |
| Force push | nunca usado |
| Segredos no diff | nenhum encontrado; `.env*` fora do commit |

**Aviso de topologia, que continua valendo:** o diretório pai empurra para
`repositorio-pai`, nunca para `main`. Um `push --force` de `main` a partir do pai
apaga o produto no GitHub.

---

## VEREDITO

**O que foi corrigido e provado:** o falso sucesso entre operadores no
pareamento (P1, com mutação detectada) e o enquadramento da gema no celular (P2,
com dois defeitos, o segundo pego antes de sair). Ambos com regressão.

**O que foi construído e provado em unidade:** `git pull` como habilidade, com
allowlist, recusa de árvore suja, `--ff-only`, e a distinção entre "atualizei" e
"já estava atualizado" sustentada pelo hash.

**O que permanece desconhecido:** tudo da seção acima — e a lista é longa o
bastante para que "seguro" não seja uma palavra que eu use aqui.

**Por que NO-GO:** publicar em `main` hoje significaria publicar, junto, trabalho
não commitado de outra sessão que eu não revisei e que quebra a suíte. A missão
autoriza decisões técnicas; não autoriza assinar o trabalho de terceiros.

**O caminho para GO**, na ordem:

1. a sessão que está editando `MotorRaciocinio`, `ClienteClaude`, `BuscaWeb`,
   `MemoriaOperacional` e a frase do `fechar_aplicativo` commita ou descarta;
2. F7 volta ao verde (atualizando a asserção junto de quem mudou a frase);
3. suíte inteira verde na árvore limpa;
4. meu trabalho commita em cima, separado por assunto;
5. `pareamento-e-instalador` vira PR e entra em `main` por revisão;
6. só então push.
