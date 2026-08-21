# GATE MD-01 — a seleção foi construída

**De:** `NO-GO por construção` (não existia seleção)
**Para:** `código pronto, aguardando a prova física com 2 máquinas`

## O que mudou, camada por camada

| camada | arquivo | mudança |
|---|---|---|
| escolha | `servidor/nucleo/EscolhaDeMaquina.ts` **(novo)** | a escolha do operador, em memória, por operador, com o nome que estava na tela |
| contrato | `lib/execucao.ts` | `OrdemExecucao.id_dispositivo_alvo` — viaja na ordem, entra no jornal, o braço confere |
| transporte | `servidor/barramento/PonteDispositivos.ts` | `destinoDe(idUsuario, alvo?)` — **com alvo é ele ou `null`**, nunca outro |
| execução | `servidor/nucleo/Braco.ts` | guarda nova: alvo escolhido e não conectado → recusa que **nomeia a máquina**, e nunca cai para o motor |
| protocolo | `lib/protocolo.ts` | pacote `escolher_dispositivo` (`id: null` desfaz) e campo `escolhido` no inventário |
| socket | `servidor/barramento/Porta.ts` | trata a escolha com o dono vindo da **sessão**, nunca do pacote; revogar credencial esquece a escolha |
| estado | `servidor/barramento/SessaoOperador.ts` | o inventário passa a dizer **qual** está escolhida — servidor é a fonte, não a tela |
| cliente | `hooks/useIaraSocket.ts` | `escolherComputador(id, nome)` e `computadorEscolhido` |
| interface | `components/Dispositivos.tsx` + `globals.css` | botão **"Trabalhar nesta" / "Trabalhando aqui"**, só quando há mais de uma máquina |

## As três regras, fixadas em teste

`testes/multi-desktop.test.ts` — 8 casos, todos verdes:

1. **sem escolha, nada muda** — o último que conectou atende (MD-01);
2. **com escolha, é ela ou nada** — a outra máquina não recebe (MD-02, MD-03, MD-04);
3. **escolhida e offline → recusa que a nomeia** — sem migrar (MD-05) e sem cair
   para o motor que hospeda o processo (MD-06).

MD-05 e MD-06 são o item 8 da lista da operadora, que antes falhava: a ação
física acontecia num computador que ninguém escolheu, com relato de sucesso.

## Regressão

```
tsc --noEmit  exit 0
npm test      2033 testes · 2030 pass · 0 fail · 3 skip (Docker ausente)
build         next build ✓ compilado, 5 rotas
```

## O que AINDA NÃO está provado — e por isso o gate segue NÃO CERTIFICADO

A regra de PASS declarada pela operadora exige **efeito físico verificável em
cada máquina**:

```
2 desktops reais + 1 sessão real + Chrome real + seleção real
+ 2 ações diferentes + efeito físico conferido em cada uma
```

Falta o segundo computador ligado e pareado. Até lá, o que existe é
**especificação executável e caminho construído** — não é prova de campo, e não
vale como tal.
