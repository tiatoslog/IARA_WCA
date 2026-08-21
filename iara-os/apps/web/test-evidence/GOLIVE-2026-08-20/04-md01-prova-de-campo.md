# GATE MD-01 — prova de campo, 20/08/2026

Navegador real, build de produção (`next build`), Supabase Auth real, operadora
logada, braço real conectado por WebSocket, cérebro real.

## O que foi provado

### MD-06 · escolhida offline + motor com mãos → RECUSA (não executa aqui)

```
escolha na tela: "Pc Atos"  (desligado)
pedido:          "Crie uma pasta chamada Prova MD01 na área de trabalho"
motor:           validando — alvo fc50ff2f… escolhido e não conectado
fala:            "Você escolheu trabalhar em 'Pc Atos', e esse computador não
                  está conectado a mim agora. (…) eu não vou executar em
                  máquina que você não pediu."
oráculo de disco: a pasta NÃO existe
```

Antes desta mudança essa sequência criaria a pasta **neste** computador, calada:
`temMaos()` é verdadeiro no Windows do motor local.

### MD-05 · escolhida offline + OUTRA máquina online → não migra

```
Homeoffice: atendendo agora        Pc Atos: desligado, e ESCOLHIDO
pedido:     "Crie uma pasta chamada Prova MD05…"
motor:      validando — alvo … escolhido e não conectado
braço Homeoffice: ZERO ordens recebidas   (grep no log do braço: 0)
```

É o item 8 da lista da operadora. Antes, a ação migrava para o Homeoffice com
relato de sucesso.

### MD-02 · escolhida online → executa NELA, com efeito físico

```
escolha na tela: "Homeoffice"  (atendendo agora)
motor:  enviada_ao_dispositivo → recebida_pelo_dispositivo → executando → sucesso
        alvo=dispositivo  disp=disp-1
braço:  criar_pasta → sucesso (5 ms) — diretório existe em C:\…\Desktop\Prova MD02
oráculo de disco: a pasta EXISTE
```

---

## O DEFEITO QUE SÓ O CAMPO ACHOU

Oito testes de unidade verdes, e o produto não funcionava.

```
escolhi "Homeoffice", que estava ATENDENDO AGORA, e o motor respondeu:
    alvo 6c25ca6ab681f88a15f8f134ea2fb342 escolhido e não conectado
```

**Causa:** `MaquinaDoOperador.id` — o id que a tela mostra e devolve — é o
`id_credencial` (`inventarioDeMaquinas`: `id: p.id_credencial`). `destinoDe`
comparava com `d.id_dispositivo`, que é o id do SOCKET (`disp-1`), novo a cada
conexão. **Para uma máquina pareada os dois nunca são iguais.**

Os dublês da suíte usavam o mesmo valor para as duas coisas — por isso oito
testes não viam. Corrigido: o alvo casa por `id_credencial` **ou**
`id_dispositivo`. Regressão: `MD-09`.

É a justificativa inteira de este gate exigir prova de campo.

---

## O que o banco diz sobre as máquinas (evidência da pergunta "os status estão coerentes?")

| nome | plataforma | pareado em | último uso | revogado |
|---|---|---|---|---|
| Pc Atos | win32 **10.0.19045** (Windows 10) | 20/08 15:50 | 20/08 15:52 | — |
| Homeoffice | win32 **10.0.26200** (Windows 11) | 16/08 01:11 | agora | — |
| Note | 10.0.26200 | 15/08 | 15/08 | 16/08 |
| Notebook da Daiane 2 | 10.0.26200 | 14/08 | 14/08 | 14/08 |
| computador ×3 | 10.0.26200 | 14/08 | 14/08 | 14/08 |

São **duas máquinas físicas diferentes** — builds distintos do Windows — e cinco
pareamentos revogados, corretamente fora da tela. A identidade está certa.
O que estava errado era a LEITURA que a folha dava dela.

## Ressalva de ambiente, declarada

O pareamento mora no Supabase (compartilhado), mas a CONEXÃO é por servidor. Um
braço conectado ao `iara.up.railway.app` aparece como **desligado** nesta
instância local, e vice-versa. Ao ler status, é preciso saber a qual IARA a tela
está falando.
