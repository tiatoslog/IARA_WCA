# IARA OS

Escritório digital vivo da Atos Log. Um mordomo corporativo que atende até cinco
operadores, com isolamento de memória entre eles, e que projeta o próprio
trabalho numa sala em pixel art — de forma computacionalmente honesta.

**Não é um dashboard.** É um escritório. A interface é consequência do ambiente:
ao propor qualquer elemento novo, a pergunta é *"que objeto da sala é isto?"*.

## Subindo

```bash
cd iara-os/apps/web
npm install
npm run dev
```

`http://localhost:3000`. Um comando sobe **dois processos**: o motor cognitivo
(WebSocket, 8787) e o Next (3000).

A `ANTHROPIC_API_KEY` é **opcional**. Sem ela o sistema roda inteiro em modo
local — clima, infraestrutura, histórico de incidentes, hora, busca web — e diz
na interface que a camada de raciocínio está desligada, em vez de improvisar.

## Árvore do projeto

```
.
├── iara-os/apps/
│   ├── web/                  o sistema (motor cognitivo + interface)
│   │   ├── lib/              contrato de domínio, servidor e cliente
│   │   ├── servidor/         motor: núcleo, kernel, barramento, canais
│   │   ├── app/ components/ hooks/    camada de projeção
│   │   ├── scripts/          utilitários, separados por o que fazem com o disco
│   │   │   ├── diagnostico/  SÓ LEEM
│   │   │   ├── provas/       ponta a ponta, escrevem só em temporário
│   │   │   ├── geracao/      ESCREVEM artefatos no repositório
│   │   │   └── docs/         geram a documentação
│   │   ├── testes/           suíte que roda no CI
│   │   ├── dados/            base determinística e shards privados
│   │   └── supabase/         schema.sql
│   └── desktop/              casca Tauri e agente local
├── docs/
│   ├── manual/               seções escritas à mão
│   ├── gerado/               saída automática — não editar
│   ├── relatorios/           auditorias e encerramentos (congelados)
│   └── especificacao/        documento de origem
├── arquivos/
│   ├── documentos/           contratos e especificações em binário
│   ├── packs-arte/           fora do Git (licença)
│   └── identidade-metahuman/ fora do Git (licença)
└── CLAUDE.md                 instruções do repositório
```

Cada pasta tem um `README.md` dizendo o que vai ali **e o que não vai**.

## Comandos

Todos a partir de `iara-os/apps/web`.

| Comando | O que faz |
|---|---|
| `npm run dev` | motor e web, um comando |
| `npm run verificar` | caminhos, GLSL, tipos e testes — o que o CI roda |
| `npm run docs` | regenera a documentação em `docs/gerado/` |
| `npm run build` | build de produção |
| `npm start` | sobe o sistema (lê `PORT` do ambiente) |
| `npm run limpar` | apaga `.next` corrompido |
| `npm run marca` / `npm run icones` | regeram os artefatos de marca |
| `npm run vozes` / `npm run medir:voz` | diagnóstico do caminho de voz |

⚠️ Não rode `npm run build` com o `npm run dev` ativo — os dois compartilham
`.next` e o dev quebra. Se acontecer: `npm run limpar`.

## Documentação

```bash
cd iara-os/apps/web
npm run docs
```

Produz **Markdown, HTML, Word e PDF** em `docs/gerado/`, combinando duas fontes
que nunca se misturam:

- **Derivado do código**, relido a cada execução: dependências, rotas,
  habilidades do kernel, regras de negócio com o comentário que as justifica,
  tabelas do banco, variáveis de ambiente, rotinas agendadas, comandos.
- **Escrito à mão** em `docs/manual/`: por que o sistema existe, quem responde
  por ele, o que dá errado às três da manhã, débitos técnicos e riscos.

O gerador não depende de Word, LibreOffice nem pandoc — roda igual na sua máquina
e no CI. Ao final, varre o documento pronto atrás de segredo e dado pessoal, e
**falha** se achar.

O workflow `.github/workflows/documentacao.yml` regenera e recommita a cada
publicação em `main`, e publica Word e PDF como artefato do run.

## Onde ler mais

| Assunto | Onde |
|---|---|
| Arquitetura, invariantes, direção de arte | `CLAUDE.md` |
| O sistema em detalhe | `iara-os/apps/web/README.md` |
| Documentação técnica completa | `docs/gerado/IARA-OS-Documentacao.md` |
| Débitos técnicos e riscos conhecidos | `docs/manual/15-debitos-tecnicos.md`, `16-riscos.md` |
| Como assumir o sistema | `docs/manual/17-checklist-transferencia.md` |
| Histórico das auditorias | `docs/relatorios/` |
