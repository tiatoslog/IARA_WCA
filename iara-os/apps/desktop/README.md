# IARA Desktop — shell Tauri

A presença da IARA no Windows: **bolha flutuante** sempre acessível, **atalho
global Alt+Space** e o painel completo (o mesmo escritório do navegador,
projetado num app nativo via WebView2).

## Casca fina (12/08/2026)

Até esta data o shell subia um **motor Node completo na máquina de cada
operador** — Next, tsx transpilando TypeScript em runtime, WebSocket e o ciclo
cognitivo, por pessoa. Era o sistema inteiro instalado em cada computador, e era
de onde vinha a máquina ficar lenta.

Agora o motor mora na nuvem e este app é o que sempre deveria ter sido: uma
janela. Ele **não instala nada** — sem Node, sem npm, sem `npm run build`.

| Camada | Onde | O que faz |
|---|---|---|
| Cognição + memória + agente local | motor na nuvem (Railway) | Roteador, kernel, memória, voz e as ações no computador |
| Interface | Vercel (ou o próprio motor, em modo unificado) | O escritório |
| Shell nativo | este app (Rust/Tauri) | Bolha arrastável, Alt+Space, janela que recolhe em vez de fechar |

Nenhuma ação de sistema é executada pelo Rust: tudo passa pelo `AgenteLocal` do
motor, com allowlist, raízes autorizadas e confirmação R2, auditado no canal
`agente_local`. **Isso muda na Fase 3**, quando o motor na nuvem deixar de
alcançar esta máquina sozinho e o braço passar a ser aqui.

## Para onde a janela aponta

Nesta ordem, e a primeira que responder vence:

1. `IARA_URL` — o loop de desenvolvimento (`http://localhost:3000`).
2. `%APPDATA%\br.com.atoslog.iara\destino.json`, no formato `{ "url": "https://…" }`
   — troca homologação↔produção numa máquina instalada, sem recompilar.
3. `IARA_URL_PADRAO`, assada em tempo de build (é assim que o instalador sai
   apontando para o lugar certo).
4. O literal em `main.rs`.

**Só `https://` é aceito**, exceto `localhost`, `127.0.0.1` e `[::1]`. Uma janela
do produto carregando `http://` de um host remoto é um intermediário podendo
reescrever a página onde a operadora digita a senha. A comparação de host é
exata, nunca por prefixo — `localhost.evil.com` é recusado, e há teste para isso.

## O que impede a janela de mostrar o app de um estranho

O shell sonda `<destino>/saude` antes de navegar e exige a assinatura
`"app":"iara"`. Status 200 não é prova: um portal de Wi-Fi público ou um proxy
corporativo devolve 200 com HTML, e sem essa checagem a janela carregaria a
página deles dentro da moldura da IARA, sem um aviso sequer.

Sem alcançar a IARA, a janela abre em `ui/offline.html` — o endereço tentado, o
motivo e um botão. Uma thread continua sondando a cada 15 s e **navega sozinha**
quando o motor responder; o clique existe para quem não quer esperar.

## Rodando pela primeira vez (desenvolvimento)

1. **Ambiente de build** (uma vez só — instala Rust + Build Tools, ~2 GB):
   ```powershell
   .\instalar-ambiente.ps1
   ```
2. **O motor**, em `apps\web`:
   ```powershell
   npm run dev
   ```
3. **O app**, apontado para ele:
   ```powershell
   $env:IARA_URL = "http://localhost:3000"
   npm run dev
   ```

Se preferir que o shell suba o motor sozinho (sem terminal, como o app antigo
fazia), declare `IARA_MOTOR_LOCAL=1`. Esse caminho continua no `main.rs`, dentro
do módulo `local`, e é **ferramenta de desenvolvimento, não o produto** — ele
exige `npm run build` prévio em `apps\web`.

`npm run build` gera o instalador (MSI/NSIS) em `src-tauri/target/release/bundle/`.
Para assar o destino no instalador:

```powershell
$env:IARA_URL_PADRAO = "https://iara.atoslog.com.br"
npm run build
```

### Testes

```powershell
cd src-tauri
cargo test
```

Cobrem as duas decisões que erram em silêncio: qual destino é aceitável
(HTTPS-só, host exato) e o que conta como assinatura da IARA.

## Assets locais

`ui/` é o `frontendDist` e é servido pelo protocolo interno do Tauri em dev **e**
em produção — não há `devUrl`. Isso não é detalhe: a página offline seria
impossível de mostrar se fosse servida pelo motor, que é justamente o que não
está respondendo quando ela aparece. Um asset local não pode depender do
servidor que ele existe para substituir.

`copiar-bolha.mjs` só copia a esfera de `apps/web/public/marca/iara-esfera.png`
para `ui/`.

## Ícone

Antes do primeiro build de instalador, gere os ícones a partir de um PNG
1024x1024 (a identidade da IARA):

```powershell
npx tauri icon caminho\para\iara.png
```

## Próximas fases

- **Fase 3 — o braço.** Canal WebSocket persistente com o motor por onde chegam
  pedidos de vocabulário fechado (criar pasta, abrir aplicativo de tabela
  `const`, energia), com allowlist própria no Rust como segunda barreira,
  pareamento por código e auditoria local. Uma conta, vários computadores, e a
  IARA escolhendo qual usar a partir da linguagem natural.
- Bolha refletindo o `EstagioCognitivo` real (snapshot via WebSocket, mesma
  fonte do navegador — a bolha nunca inventa estado).
