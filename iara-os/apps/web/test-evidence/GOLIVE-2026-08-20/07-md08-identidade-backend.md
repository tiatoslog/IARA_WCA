# MD-08 — identidade do backend · PASS

> *"Você consegue provar 'o Railway respondeu', mas não 'o Railway respondeu
> usando exatamente o código que acabou de ser auditado'."*

## Onde ela aparece

**1. Na subida**
```
[iara] código: v1.0.0 · 170a641 (disco) · ambiente desconhecido
```

**2. Em `/saude`** — sem login, é o healthcheck do host
```json
"backend": {
  "versao": "1.0.0",
  "git_sha": "170a641aac96647f5a50438d3770bce7072c5329",
  "git_sha_curto": "170a641",
  "git_origem": "disco",
  "ambiente": "desconhecido",
  "iniciado_em": "2026-08-20T17:43:22.114Z"
}
```

**3. Ao lado de CADA execução**, no canal auditável
```json
{
  "canal": "execucao",
  "execucao_id": "IARA-20260820-e1a5-000003",
  "acao": "criar_pasta",
  "estado": "sucesso",
  "dispositivo": "disp-3",
  "detalhe": "diretório existe em C:\Users\daian\Desktop\Carimbo MD08",
  "backend": { "sha": "170a641", "versao": "1.0.0", "ambiente": "desconhecido" }
}
```

## A regra: não inventar

Mesma disciplina de `lerStatusDaMaquina` e de `Cobertura.percentual`. Um
`git_sha` chutado é PIOR que `null` — `null` faz alguém ir procurar; um sha
errado faz alguém PARAR de procurar, com a conclusão errada na mão.

| origem | de onde | quando |
|---|---|---|
| `ambiente` | `IARA_GIT_SHA`, `RAILWAY_GIT_COMMIT_SHA`, `GIT_COMMIT_SHA` | imagem publicada — a única fonte que sabe o que foi PUBLICADO |
| `disco` | `.git/HEAD`, subindo a árvore | motor de desenvolvimento |
| `nenhuma` | — | `git_sha: null`, dito em voz alta |

`IB-06`: sha malformado (`''`, `'HEAD'`, `'a1b2c3'`, `'<script>'`) é **recusado**,
nunca repassado. Um valor não vira sha por estar numa variável com o nome certo.

`ambiente: 'desconhecido'` é valor legítimo — dizer "produção" por padrão faria
um log de desenvolvimento passar por um de produção no dia do incidente.

## Duas descobertas medidas na subida real

A primeira execução imprimiu `sha desconhecido`. Duas causas, as duas
específicas deste repositório, as duas viraram teste:

1. **O app mora em `iara-os/apps/web/`** e o `.git` fica na raiz, três níveis
   acima. Procurar só ao lado devolve `null` no layout normal do projeto.
2. **`.git` aqui é um ARQUIVO, não uma pasta** — `IARA_WCA` é submódulo, e
   submódulo guarda `gitdir: ../.git/modules/<nome>` num arquivo de uma linha.

`IB-11` reproduz o layout inteiro (submódulo + app fundo na árvore) e `IB-12`
garante que sem `.git` em nenhum nível continua `null`. O teto de subida é 6
níveis de propósito: sem ele, um processo em `/app` varreria a raiz do sistema
atrás de um `.git` que não existe — e poderia achar o de outro projeto montado
por acaso.

Sem `execFile`: ler dois arquivos é mais barato, não depende de `git` existir no
contêiner, e mantém o módulo do lado certo da fronteira interna — declarado em
`Fronteira.ts`, como o guarda do repositório exigiu.

## Regressão

```
tsc --noEmit  exit 0
npm test      2060 testes · 2057 pass · 0 fail · 3 skip
varredura     árvore rastreada limpa
next build    ✓ compilado
```

## O que isto habilita

No Railway, `RAILWAY_GIT_COMMIT_SHA` é carimbado pelo pipeline, então
`git_origem` será `ambiente` e o sha será o do deploy. Aí o MD-07 deixa de ser
"o Railway respondeu" e vira **"o Railway respondeu com o sha X"** — conferível
contra o commit auditado.
