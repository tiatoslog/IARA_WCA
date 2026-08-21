## Escopo

### O que está dentro

- Atendimento conversacional a até cinco operadores, por navegador, PWA
  instalável, aplicativo desktop (Tauri) e WhatsApp.
- Isolamento de memória por operador, com sondagem cruzada barrada por regra
  determinística antes de chegar ao modelo.
- Consultas operacionais: clima, infraestrutura, histórico de incidentes,
  agenda, hora, busca web.
- Ações locais na máquina do operador via IARA Desktop, sempre com confirmação
  humana.
- Projeção do estado cognitivo em duas formas: o escritório em pixel art e a
  presença 3D.
- Trilha de auditoria em jornal append-only, com selo HMAC quando
  `IARA_CHAVE_PROVA` está configurada.

### O que está fora, e por quê

- **Não é um ERP nem substitui um.** Ela consulta dados operacionais; não é
  sistema de registro deles.
- **Não decide sozinha.** Toda ação de risco alto exige confirmação explícita. A
  LLM emite intenções estruturadas; quem valida e aplica é o `EstadoAtomico`.
- **Não é multi-tenant.** O roster é lista fechada em `lib/operadores.ts`,
  revisada em commit. Não existe cadastro automático em lugar nenhum do código.
- **Não usa a persona da Convai.** Apenas o endpoint de síntese de fala é
  consumido. Colocar o SDK de personagem no lugar do roteador e do RAG mandaria
  mensagem de operador para fora do perímetro.

### Limites de capacidade declarados no código

| Limite | Valor | Onde |
|---|---|---|
| Operadores no roster | 5 | `lib/operadores.ts` |
| Espelhos simultâneos por operador | 4 | `servidor/barramento/Porta.ts` |
| Apresentações por minuto, pré-autenticação | 120 | `servidor/barramento/Porta.ts` |
| Lembretes pendentes por operador | 50 | `servidor/nucleo/Agenda.ts` |
