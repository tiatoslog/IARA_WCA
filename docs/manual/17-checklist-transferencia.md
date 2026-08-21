## Checklist de transferência

Para quem vai assumir o sistema. Cada item é uma verificação, não uma leitura.

### Acesso

- [ ] Acesso de escrita ao repositório Git
- [ ] Acesso ao painel do Supabase, com permissão de administrador
- [ ] Acesso ao painel do host do motor (Railway)
- [ ] Acesso ao painel do host do front (Vercel), se o deploy for separado
- [ ] Acesso ao console da Anthropic
- [ ] Acesso ao Meta Business, se o canal WhatsApp estiver ligado
- [ ] Acesso ao cofre onde os segredos ficam guardados
- [ ] Acesso ao registrador do domínio

### Entendimento

- [ ] Leu *Visão geral*, *Arquitetura* e *Invariantes não negociáveis*
- [ ] Entende por que a interface é um escritório e não um dashboard
- [ ] Entende as três camadas e por que 80% das perguntas não chegam ao modelo
- [ ] Entende o isolamento entre operadores e por que o prompt é a última defesa
- [ ] Leu a lista de *Débitos técnicos* e sabe qual não pode ser ignorado (D-2,
      antes de ligar o token do WhatsApp)

### Prova prática

- [ ] Clonou, rodou `npm install` e `npm run dev` com sucesso
- [ ] `npm run verificar` passa na máquina nova
- [ ] `npm run docs` regenera esta documentação
- [ ] Conversou com a IARA em modo local (sem chave) e viu o aviso na interface
- [ ] Conversou com a IARA com chave e viu o rack pulsar
- [ ] Fez um deploy de teste e viu o healthcheck passar
- [ ] Restaurou um backup do banco num ambiente de teste

### Governança

- [ ] Tabelas de *Custos e contas* preenchidas
- [ ] Tabela de *Responsabilidades* preenchida
- [ ] Pendências de *Segurança e LGPD* endereçadas ou aceitas formalmente
- [ ] Procedimentos de *Backup e recuperação* definidos e testados uma vez
- [ ] Segredos rotacionados após a transferência
