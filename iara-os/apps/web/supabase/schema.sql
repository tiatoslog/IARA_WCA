-- =============================================================================
-- IARA OS — schema do Supabase
--
-- Cole inteiro no SQL Editor do Supabase e rode uma vez. É idempotente:
-- pode rodar de novo sem quebrar nada.
--
-- POSTURA DE SEGURANÇA
-- Nesta arquitetura o navegador NUNCA fala com o Supabase. Só o motor fala,
-- com a service_role. Por isso o RLS abaixo é ligado com política NENHUMA para
-- anon/authenticated: se a anon key vazar, ela não lê uma linha sequer.
-- A service_role ignora RLS por definição — é por isso que ela só existe no
-- servidor e nunca com prefixo NEXT_PUBLIC_.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Infraestrutura (substitui dados/infraestrutura.json)
-- -----------------------------------------------------------------------------
create table if not exists public.centrais (
  id            bigint generated always as identity primary key,
  nome          text not null,
  uf            text not null,
  ativa         boolean not null default true,
  veiculos      integer not null default 0 check (veiculos >= 0),
  atualizado_em timestamptz not null default now(),
  unique (nome, uf)
);

create index if not exists centrais_uf_ativa_idx on public.centrais (uf, ativa);

-- -----------------------------------------------------------------------------
-- 2. RAG schema-only (substitui dados/historico-erros.json)
--
-- REGRA PÉTREA: não existe coluna de log bruto aqui, e isso é proposital.
-- O que não é armazenado não pode ser injetado no contexto do modelo.
-- -----------------------------------------------------------------------------
create table if not exists public.erros_assinaturas (
  hash                text primary key,
  assinatura          text not null,
  sistema             text not null,
  primeira_ocorrencia date,
  ultima_ocorrencia   date,
  ocorrencias         integer not null default 1 check (ocorrencias > 0),
  resolucao           text not null
);

create index if not exists erros_sistema_idx on public.erros_assinaturas (sistema);

-- -----------------------------------------------------------------------------
-- 3. Memória operacional — shards privados
--
-- O isolamento continua sendo garantido pelo motor, que deriva o id_usuario da
-- sessão do socket. O banco é a terceira linha de defesa, não a primeira.
-- -----------------------------------------------------------------------------
create table if not exists public.memoria_registros (
  id         uuid primary key default gen_random_uuid(),
  id_usuario text not null,
  instante   timestamptz not null default now(),
  papel      text not null check (papel in ('operador', 'iara')),
  texto      text not null,
  destino    text
);

create index if not exists memoria_usuario_instante_idx
  on public.memoria_registros (id_usuario, instante desc);

create table if not exists public.insights_relacionais (
  id         uuid primary key default gen_random_uuid(),
  id_usuario text not null,
  gerado_em  timestamptz not null default now(),
  titulo     text not null,
  detalhe    text not null,
  proativo   boolean not null default true
);

create index if not exists insights_usuario_proativo_idx
  on public.insights_relacionais (id_usuario, proativo);

-- A ficha que o operador escreveu sobre si: como ser chamado, como ser tratado,
-- o que ele quer que a IARA leve em conta. Uma linha por operador — `id_usuario`
-- é a chave primária, e é o upsert que mantém isso verdadeiro.
create table if not exists public.operador_preferencias (
  id_usuario    text primary key,
  preferencias  jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- Lembretes que o operador deixou marcados. `entregue_em` nulo = ainda espera;
-- é esse campo que faz um lembrete tocar UMA vez, e não a cada varredura do
-- ciclo autônomo. O índice parcial é a consulta quente: "o que vence agora,
-- deste operador".
create table if not exists public.agenda_lembretes (
  id          uuid primary key default gen_random_uuid(),
  id_usuario  text not null,
  criado_em   timestamptz not null default now(),
  vence_em    timestamptz not null,
  assunto     text not null,
  entregue_em timestamptz
);

create index if not exists agenda_pendentes_idx
  on public.agenda_lembretes (id_usuario, vence_em)
  where entregue_em is null;

-- -----------------------------------------------------------------------------
-- 4. RLS: ligado, sem política. Ninguém além da service_role entra.
-- -----------------------------------------------------------------------------
alter table public.centrais             enable row level security;
alter table public.erros_assinaturas    enable row level security;
alter table public.memoria_registros    enable row level security;
alter table public.insights_relacionais enable row level security;
alter table public.operador_preferencias enable row level security;
alter table public.agenda_lembretes     enable row level security;

-- Nenhuma policy é criada de propósito. Sem policy + RLS ligado = acesso
-- negado para anon e authenticated. Se um dia o navegador precisar ler
-- `centrais` direto, crie uma policy de SELECT explícita apenas para ela —
-- jamais para memoria_registros, insights_relacionais ou
-- operador_preferencias. A ficha é tão privada quanto o histórico: ela diz
-- como a pessoa quer ser chamada, e isso é dela.

-- -----------------------------------------------------------------------------
-- 5. Carga inicial (os mesmos dados dos JSON semente)
-- -----------------------------------------------------------------------------
insert into public.centrais (nome, uf, ativa, veiculos) values
  ('Cuiabá Matriz',    'MT', true,  84),
  ('Rondonópolis',     'MT', true,  41),
  ('Sinop',            'MT', true,  33),
  ('Sorriso',          'MT', true,  27),
  ('Barra do Garças',  'MT', false,  0),
  ('Campo Grande',     'MS', true,  52),
  ('Dourados',         'MS', true,  24),
  ('Rio Verde',        'GO', true,  38),
  ('Goiânia',          'GO', true,  46),
  ('Acreúna',          'GO', true,  12),
  ('Ribeirão Preto',   'SP', true,  63),
  ('Londrina',         'PR', true,  29)
on conflict (nome, uf) do nothing;

insert into public.erros_assinaturas
  (hash, assinatura, sistema, primeira_ocorrencia, ultima_ocorrencia, ocorrencias, resolucao)
values
  ('e1a77c', 'ECONNRESET no pool de conexões do Postgres sob pico de emissão', 'api-ctes',
   '2026-01-14', '2026-03-22', 7,
   'Pool estava abaixo do pico real. Subimos max de 10 para 25 e adicionamos keepalive; o idle_timeout do PgBouncer estava menor que o do driver.'),
  ('b39012', 'Timeout de 504 no gateway durante geração de relatório mensal', 'portal-web',
   '2026-02-02', '2026-02-28', 4,
   'Relatório era síncrono. Movido para fila com notificação ao final; o gateway deixou de esperar.'),
  ('77fd41', 'Falha de autenticação no webservice da SEFAZ por certificado A1 vencido', 'integracao-fiscal',
   '2025-11-30', '2026-05-11', 3,
   'Renovação do certificado e alarme de 30 dias antes do vencimento no monitoramento.'),
  ('a04e8b', 'Container do banco reiniciando em loop por falta de espaço em disco', 'infra-docker',
   '2026-03-08', '2026-06-19', 5,
   'WAL sem rotação ocupando o volume. Rotação configurada e alerta em 80% de uso.'),
  ('5c2d90', 'Duplicidade de CT-e na baixa automática por reprocessamento de fila', 'baixa-ctes',
   '2026-04-17', '2026-07-25', 6,
   'Consumidor não era idempotente. Chave de deduplicação por chave de acesso do CT-e antes da gravação.'),
  ('9be115', 'Latência alta no rastreamento por índice ausente em coluna de placa', 'api-rastreio',
   '2026-05-02', '2026-05-06', 2,
   'Criado índice composto (placa, data_evento). Consulta caiu de 4s para 40ms.')
on conflict (hash) do nothing;
