## Desenvolvimento local

```bash
cd iara-os/apps/web
npm install
npm run dev
```

`http://localhost:3000`. Um comando sobe **dois processos**: o motor cognitivo
(WebSocket, 8787) e o Next (3000).

A chave da Anthropic é opcional. Sem ela o sistema roda inteiro em modo local e
diz na interface que a camada de raciocínio está desligada.

### Antes de abrir PR

```bash
npm run verificar
```

Roda, nesta ordem: verificação de caminhos relativos, guarda de GLSL,
`tsc --noEmit` e a suíte de testes.

### Armadilhas conhecidas do ambiente

**Não rode `npm run build` com o `npm run dev` ativo.** Os dois compartilham
`.next` e o dev quebra. Se acontecer: `npm run limpar`.

**Crase dentro de bloco GLSL.** Os shaders moram em template literals. Escrever
uma crase num comentário GLSL — hábito natural, porque é assim que se cita um
símbolo em TypeScript — fecha o template ali, e o resto do shader vira
JavaScript. O erro reportado não menciona crase nenhuma: aponta para uma palavra
qualquer, dezenas de linhas antes do problema real. `npm run verificar` tem uma
guarda contra isso.

**Verificar cena 3D em painel de navegador não funciona.** O painel não compõe
frames, a cena React Three Fiber não inicializa, e o sintoma engana. Verifique em
Node.

**A pasta do projeto está dentro do OneDrive.** A árvore de arquivos pode mudar
sozinha durante o trabalho. Confie no estado do Git e commite cedo.

### Aplicativo desktop

`iara-os/apps/desktop` é uma casca Tauri que embute a interface e provê o agente
local (criar pasta, abrir aplicativo, energia). O contrato com a bolha está em
`ui/bolha.html`. Ver o README da própria pasta.
