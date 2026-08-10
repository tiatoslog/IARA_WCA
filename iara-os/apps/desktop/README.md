# IARA Desktop — shell Tauri

A presença da IARA no Windows: **bolha flutuante** sempre acessível, **atalho
global Alt+Space** e o painel completo (o mesmo escritório do navegador,
projetado num app nativo via WebView2).

## Divisão de responsabilidade

| Camada | Onde | O que faz |
|---|---|---|
| Cognição + agente local | `apps/web` (motor Node, porta 3000) | Roteador, kernel, memória, voz e as ações no computador (criar pasta, abrir aplicativo, energia com confirmação) |
| Shell nativo | este app (Rust/Tauri) | Bolha arrastável, Alt+Space, janela que recolhe em vez de fechar |

As ações locais **já funcionam hoje** pelo navegador — o shell só dá corpo à
presença. Nenhuma ação de sistema é executada pelo Rust: tudo passa pelo
`AgenteLocal` do motor, com allowlist, raízes autorizadas e confirmação R2,
auditado no canal `agente_local`.

## O motor sobe sozinho (V4)

O shell verifica a porta 3000 ao abrir. Se o motor não está de pé, ele o sobe
**sem janela de terminal** (`CREATE_NO_WINDOW`), em modo produção, e derruba a
árvore de processos quando o app encerra de verdade. A experiência final é
**abrir IARA.exe** — nunca "primeiro rode `npm run dev` num cmd preto".

Pré-requisito único (uma vez, ou após atualizar o código do motor):

```powershell
cd iara-os\apps\web
npm install
npm run build
```

O shell procura o motor nesta ordem: variável `IARA_MOTOR_DIR`; pasta `motor`
ao lado do executável; o repositório, subindo a árvore a partir do executável
(cobre `target\release` e `target\debug` no desenvolvimento).

Sem Supabase configurado, o filho sobe com `IARA_PERMITIR_MODO_LOCAL=1` —
processo localhost do próprio operador, decisão consciente. Com Supabase no
`.env.local`, a autenticação real assume e a variável é irrelevante.

## Rodando pela primeira vez (desenvolvimento)

1. **Ambiente de build** (uma vez só — instala Rust + Build Tools, ~2 GB):
   ```powershell
   .\instalar-ambiente.ps1
   ```
2. **O app** (ele sobe o motor sozinho se a porta 3000 estiver muda):
   ```powershell
   cd iara-os\apps\desktop
   npm run dev
   ```
   Para o motor com hot reload, rode antes `npm run dev` em `apps\web` — o
   shell detecta a porta ocupada e não duplica nada.

`npm run build` gera o instalador (MSI/NSIS) em `src-tauri/target/release/bundle/`.

## Ícone

Antes do primeiro build de instalador, gere os ícones a partir de um PNG
1024x1024 (a identidade da IARA):

```powershell
npx tauri icon caminho\para\iara.png
```

## Próximas fases (na especificação v2)

- Bolha refletindo o `EstagioCognitivo` real (snapshot via WebSocket, mesma
  fonte do navegador — a bolha nunca inventa estado).
- Enrollment de dispositivo para o cenário multi-máquina (backend na nuvem,
  agente puxando tarefas — seção 22 da especificação).
