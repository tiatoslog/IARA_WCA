## Deploy

### Modo unificado: um processo, uma porta

O Next e o motor rodam juntos em `servidor/principal.ts`, com o barramento em
`/barramento` na mesma origem. Qualquer host que execute Node serve o sistema
inteiro.

```bash
npm ci
npm run build
npm start
```

| Host | Custo aproximado | Observação |
|---|---|---|
| **Railway** | cerca de US$ 5/mês | detecta Node, injeta `PORT`, dá domínio HTTPS |
| **Render** | free ou cerca de US$ 7/mês | o free hiberna e derruba o WebSocket; use pago |
| **Fly.io** | cerca de US$ 3/mês | mais controle, exige `fly.toml` |
| **VPS** | cerca de US$ 5/mês | precisa de Nginx e Certbot na mão |

> Valores acima são ordem de grandeza pública dos provedores, não a fatura da
> Atos Log. A conta real está em *Custos e contas*.

**A Vercel não serve para o processo inteiro, em plano nenhum.** Serverless não
mantém WebSocket aberto, não preserva memória entre invocações e tem sistema de
arquivos somente leitura. O motor precisa de host de processo longo.

### Modo separado: Next na Vercel, motor no Railway

`IARA_MODO=headless` faz o motor subir **sem** instanciar o Next, entregando só
o que exige estado vivo: o WebSocket, o áudio da voz (que mora em memória) e o
webhook do WhatsApp.

**Railway** — Root Directory `iara-os/apps/web`, builder Dockerfile.
**Vercel** — Root Directory `iara-os/apps/web`, definido no painel (não cabe no
`vercel.json`). Só três variáveis, e nenhum segredo.

### Três coisas que quebram o deploy em silêncio

1. **`NEXT_PUBLIC_*` é embutida em tempo de build.** Num deploy por Docker ela
   precisa estar declarada como `ARG` no Dockerfile — variável de serviço do host
   chega em runtime, e o build nunca a enxerga. Esquecer não quebra o deploy: o
   motor sobe, o healthcheck passa, a página abre, e o navegador recebe um bundle
   que não sabe que existe Supabase.
2. **`IARA_ORIGENS` vazio em headless** significa que ninguém conecta. O
   navegador **não** aplica CORS a WebSocket — essa lista é a única trava, e em
   headless "mesma origem" não existe.
3. **Curinga em `IARA_ORIGENS` faz o motor recusar subir** em produção. Qualquer
   pessoa registra um subdomínio num host gratuito em minutos: o curinga não
   alarga a lista, substitui ela pela internet. Para preview, suba um segundo
   motor com `IARA_AMBIENTE=homologacao` e banco próprio.

**Voltar atrás custa uma variável.** `IARA_MODO` vazio devolve o sistema inteiro
a um endereço só — é por isso que o Dockerfile continua rodando `npm run build`
mesmo quando o processo sobe headless.

### Preparar o banco

Cole `supabase/schema.sql` inteiro no SQL Editor do Supabase e rode. É
idempotente.

### PWA

O app é instalável: manifesto em `app/manifest.ts`, service worker em
`public/sw.js`, ícones por `npm run icones`. O service worker cacheia só a
casca — sprites, ícones e o documento. Nada de conversa, telemetria ou estado:
servir resposta velha do cache seria mentir para o operador sobre o que está
acontecendo agora. HTTPS é obrigatório.
