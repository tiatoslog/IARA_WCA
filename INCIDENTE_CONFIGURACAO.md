# Incidente de configuração — 13/08/2026

**Classe:** contaminação de configuração → divulgação de credencial
**Gravidade:** P0 (credencial exposta ao operador e a terceiros por captura de tela)
**Veredito desta correção:** CONDITIONAL GO — ver "O que continua aberto".

Nenhum valor de segredo aparece neste documento. Onde um segredo é citado,
cita-se o **nome da variável**.

---

## 1. Sintoma

Toda mensagem enviada à IARA pelo celular respondia:

> Não consegui concluir esse pedido. Falhou em: Headers.append: "…" is an
> invalid header value.. O detalhe completo está no console técnico.

E o `"…"` era a `ANTHROPIC_API_KEY` inteira, seguida de `CRON_SECRET=` e do
valor deste. As duas credenciais ficaram legíveis na tela e numa captura.

## 2. Causa imediata

`ANTHROPIC_API_KEY`, no ambiente do host, carregava **duas configurações**:

```
ANTHROPIC_API_KEY = <chave>\nCRON_SECRET=<segredo>
```

O SDK da Anthropic põe esse valor no cabeçalho `x-api-key`. O `Headers` do
runtime recusa qualquer valor com CR ou LF, e derruba a requisição.

**A origem foi humana e banal:** um bloco de duas linhas colado no campo de
valor de **uma** variável no painel de variáveis do host. O painel aceita, e o
`\n` entra no valor. O `.env.local` desta máquina estava e está correto — a
contaminação só existe no ambiente remoto.

Um detalhe que quase desviou o diagnóstico: na tela o separador **parece um
espaço**. Espaço é caractere legal em valor de header — se a colagem tivesse
sido por espaço, o `Headers` teria **aceitado** e a requisição sairia com a
credencial errada, em silêncio. O erro barulhento foi sorte.

## 3. Causa raiz — três defeitos, nenhum deles no `Headers.append`

`Headers.append` foi o primeiro componente do sistema com rigor suficiente para
notar que a configuração estava quebrada. Ele é o detector, não a causa.

**(a) Não existia camada de validação de configuração.** Sessenta e poucos
sítios liam `process.env.X?.trim()` direto. `.trim()` era toda a disciplina do
repositório — e `.trim()` remove as **pontas**; a contaminação estava no
**meio**. O código parecia validado e não era.

**(b) Presença valia como validade.** `Porta.ts` e `habilidades/diagnostico.ts`
respondiam "a nuvem está ligada?" com `Boolean(process.env.ANTHROPIC_API_KEY
?.trim())`. Para o valor contaminado isso é `true`. O motor subia, anunciava
`Raciocínio: ONLINE`, roteava para a nuvem e falhava — uma vez por mensagem,
indefinidamente. Um sistema que se declara saudável e não atende é mais caro de
diagnosticar que um que se declara quebrado.

**(c) Exceção virava fala.** `Kernel.ts:445` pegava `(erro as Error).message` e
publicava o texto **cru** como fala da IARA. Existem ~30 sítios que fazem o
mesmo. Qualquer exceção cuja mensagem contenha uma credencial vira divulgação
de credencial. Este é o defeito mais grave dos três: os outros dois quebram o
sistema; este vaza segredo.

**Por que 730 testes verdes não pegaram:** todos configuram variáveis com
valores fictícios **bem formados**. Não havia um único teste que alimentasse
uma variável malformada, nem um que verificasse que o canal de saída não carrega
segredo. A suíte media o caminho feliz da configuração.

## 4. Correção

Não foi `trim()`, `replace()`, `split('\n')[0]` nem `catch`. Nenhum desses
existe nesta correção — todos transformariam uma configuração errada numa
aparentemente certa.

**`servidor/nucleo/kernel/Configuracao.ts` (novo).** A fronteira entre
`process.env` e o resto. Registro tipado de 30 variáveis, com natureza
(`segredo_cabecalho`, `segredo`, `url`, `numero`, `lista`…). Impõe a regra que
mata a classe: *uma variável de ambiente carrega exatamente uma configuração*.

Detecta, na ordem — contaminação antes de formato, porque a chave do incidente
tinha o prefixo `sk-ant-` **certo** e mesmo assim estava irremediável:

1. caractere de controle no interior do valor;
2. o nome de outra variável conhecida, com `=`, dentro do valor;
3. qualquer atribuição `MAIUSCULA=` dentro de um segredo;
4. código de ponto acima de `0xFF` no que vira cabeçalho — a fronteira exata
   que o `Headers` do runtime aplica, **medida**, não suposta;
5. prefixo e comprimento esperados.

Contaminada → **levanta**. Nunca limpa.

*Normalizar não é sanitizar:* espaço nas pontas (e BOM) é artefato de colagem de
um valor só, e sai. Um caractere de controle no interior, depois disso, não tem
explicação inocente. Recusar o `\n` final derrubaria deploys corretos — que é
como uma trava de segurança acaba desligada por alguém com pressa.

**Falha-fechada na subida.** `principal.ts` chama `conferirAmbiente()` **antes**
das duas falhas-fechadas que já existiam, e antes do primeiro `listen`. Com
configuração contaminada o processo **recusa subir**, listando variável e motivo
— nunca valor. Ausência continua legítima: sem chave a IARA roda local e diz isso.

**Presença deixou de valer como validade.** `nuvemLigada()` e o autodiagnóstico
passaram a usar `configUtilizavel()`. O painel ganhou o terceiro estado: chave
contaminada agora reporta `OFFLINE` com a explicação, e não `ONLINE`.
`DEGRADADO` continua sendo o modo local deliberado — mesmo sintoma, consertos
opostos.

**Redação no estrangulamento, não nos trinta `catch`.** `SessaoOperador.enviar`
é o único ponto pelo qual qualquer coisa chega ao operador — fala, console
técnico, snapshot. A redação aplica-se ao **pacote serializado**, e portanto a
todo campo de todo tipo de pacote, inclusive os que ainda não existem. Duas
camadas: os valores reais que o processo carrega (exata) e formatos conhecidos
de segredo — `sk-ant-`, JWT, `ghp_`, `xox…` — que pegam credencial de terceiro
vinda num payload.

Corrigir o `catch` do `Kernel` teria fechado 1 de ~30 caminhos. Redigir na
origem é disciplina que se esquece; redigir na saída é propriedade do canal.

## 5. Testes

`testes/configuracao-contaminada.test.ts` — 21 casos, todos com valores
fabricados. Suíte: **730 → 751, tudo passando.** Typecheck limpo.

Cobrem: a forma exata do incidente; prefixo certo não salva valor contaminado;
CR/CRLF/LF/NUL/`0x1f`/DEL; nome de outra variável embutido; **colagem por espaço**
(que o `Headers` aceitaria — falha silenciosa); as duas bordas da fronteira
latin-1; ausência de falso positivo (`\n` final, BOM, query string em lista);
`lerConfig` levanta sem citar o segredo; nenhum caminho devolve o valor
"consertado"; e o teste ponta a ponta que emite a mensagem exata do incidente e
verifica que **nada** atravessa o socket.

Dois testes existem só para impedir que alguém remova o detector achando que é
paranoia: eles reproduzem a recusa do `Headers` no runtime real, ao lado da
detecção.

## 6. O que continua aberto

**P0 — para a operadora, não para o código.** A `ANTHROPIC_API_KEY` e o
`CRON_SECRET` que apareceram na tela estão **comprometidos**. Rotacionar os
dois. Esta correção impede a repetição; não desfaz a exposição.

**P1 — a contaminação segue no host.** O código agora recusa subir com ela. O
conserto é no painel de variáveis: separar em dois campos. Enquanto não for
feito, o deploy não sobe — deliberadamente.

**Pendência conhecida — `agenda_lembretes`.** A tabela existe em
`supabase/schema.sql:91` e **não** foi aplicada ao projeto Supabase. Lembrete
funciona em arquivo local e não atravessa máquinas. Exige o SQL Editor do
console; ver seção 7.

**Não medido, portanto não afirmado:** voz, render, QR, concorrência e fuzzing.
Não encontrei problema neles porque não os medi.

**Sem CI.** Não existe pipeline neste repositório. `npm run verificar` é a porta
que existe, e ela é local.

## 7. Aplicar `agenda_lembretes`

SQL Editor do projeto Supabase. É idempotente:

```sql
create table if not exists public.agenda_lembretes (
  id          uuid primary key default gen_random_uuid(),
  id_usuario  text not null,
  criado_em   timestamptz not null default now(),
  vence_em    timestamptz not null,
  assunto     text not null,
  entregue_em timestamptz
);

create index if not exists agenda_pendentes_idx
  on public.agenda_lembretes (id_usuario, vence_em)
  where entregue_em is null;

alter table public.agenda_lembretes enable row level security;
```

Rodar `supabase/schema.sql` inteiro também resolve — o arquivo é idempotente de
ponta a ponta.

## 8. A regra, em uma linha

> Uma variável de ambiente carrega exatamente uma configuração; contaminação é
> detectada e recusada, nunca limpa; e nenhum segredo atravessa a fronteira do
> socket.
