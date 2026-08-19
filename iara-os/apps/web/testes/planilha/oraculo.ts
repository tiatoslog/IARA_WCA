/**
 * O ORÁCULO — o conjunto de dados cuja resposta é conhecida ANTES de perguntar.
 *
 * POR QUE ELE EXISTE. Até 18/08/2026, "a IARA respondeu certo?" era respondido
 * comparando o número dela com a intuição de quem perguntou. Isso já falhou
 * três vezes nesta auditoria: "2681 no total" (era o total de 2026), "18:29"
 * (eram 15:31), "LINO" (certo por acaso, porque o ano não foi conferido). Um
 * número plausível não é um número correto.
 *
 * AS CONSTANTES SÃO CONTADAS À MÃO a partir da tabela abaixo — nunca derivadas
 * chamando o código que está sendo medido. Um oráculo que usa a implementação
 * como referência passa com o defeito de pé; é o mesmo erro de conferir
 * `toLocaleString` com `toLocaleString`.
 *
 * O CONJUNTO É PEQUENO DE PROPÓSITO: vinte cargas, para que qualquer pessoa
 * refaça as contas de cabeça em dois minutos. Conjunto grande esconde erro de
 * fórmula atrás de número plausível.
 */

import { normalizarStatus, type CargaCompleta } from '../../servidor/nucleo/ClientePlanilhaOcis';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  O CONJUNTO — 2026 (a aba viva) e 2025 (histórico, fora do alcance da leitura)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ANO 2026 — doze cargas
 *  #   motorista   rota      status       coleta        valor
 *  1   LINO        SP→MT     FINALIZADO   2026-01-05     1000
 *  2   LINO        SP→MT     FINALIZADO   2026-01-20     1000
 *  3   LINO        SP→GO     PAGO         2026-02-10     2000
 *  4   LINO        SP→GO     PAGO         2026-02-15     2000
 *  5   LINO        MG→MT     (vazio)      2026-03-01     1000
 *  6   LAUDIR      SP→MT     FINALIZADO   2026-01-08     3000
 *  7   LAUDIR      SP→MT     FINALIZADO   2026-02-08     3000
 *  8   LAUDIR      MG→MT     PAGO         2026-03-12      500
 *  9   LAUDIR      MG→MT     (vazio)      2026-03-20      500
 * 10   MOLINA      SP→GO     FINALIZADO   2026-01-30        0
 * 11   MOLINA      SP→GO     CANCELADA    2026-02-28     null   ← valor AUSENTE
 * 12   (vazio)     MG→GO     FINALIZADO   2026-03-30     1000   ← motorista AUSENTE
 *
 *  ANO 2025 — oito cargas (existem no arquivo; a leitura atual NÃO as alcança)
 * 13   LINO        SP→MT     FINALIZADO   2025-06-01     1000
 * 14   LINO        SP→MT     FINALIZADO   2025-06-02     1000
 * 15   LAUDIR      SP→GO     PAGO         2025-07-01     1000
 * 16   LAUDIR      SP→GO     PAGO         2025-07-02     1000
 * 17   MOLINA      MG→MT     FINALIZADO   2025-08-01     1000
 * 18   MOLINA      MG→MT     FINALIZADO   2025-08-02     1000
 * 19   DIRCEU      MG→GO     (vazio)      2025-09-01     1000
 * 20   DIRCEU      MG→GO     CANCELADA    2025-09-02     1000
 *
 *  DUPLICIDADE PROPOSITAL: a carga 21 repete a OCI da 1, com todos os demais
 *  campos iguais. Existe para separar "linhas da planilha" de "cargas únicas" —
 *  ver `ESPERADO.linhas_2026` contra `ESPERADO.ocis_unicas_2026`.
 * 21   LINO        SP→MT     FINALIZADO   2026-01-05     1000   ← OCI repetida (=1)
 */

const c = (
  oci: string,
  motorista: string,
  origem: string,
  destino: string,
  status: string,
  data_coleta: string,
  valor: number | null,
): CargaCompleta => ({
  oci,
  origem,
  uf_origem: origem,
  destino,
  uf_destino: destino,
  motorista,
  data_rec_oci: data_coleta,
  data_coleta,
  data_descarga: data_coleta,
  status,
  status_normalizado: normalizarStatus(status),
  valor,
});

/** A aba viva. É o que a leitura atual enxerga. */
export const CARGAS_2026: readonly CargaCompleta[] = [
  c('OCI-001', 'LINO', 'SP', 'MT', 'FINALIZADO', '2026-01-05', 1000),
  c('OCI-002', 'LINO', 'SP', 'MT', 'FINALIZADO', '2026-01-20', 1000),
  c('OCI-003', 'LINO', 'SP', 'GO', 'PAGO', '2026-02-10', 2000),
  c('OCI-004', 'LINO', 'SP', 'GO', 'PAGO', '2026-02-15', 2000),
  c('OCI-005', 'LINO', 'MG', 'MT', '', '2026-03-01', 1000),
  c('OCI-006', 'LAUDIR', 'SP', 'MT', 'FINALIZADO', '2026-01-08', 3000),
  c('OCI-007', 'LAUDIR', 'SP', 'MT', 'FINALIZADO', '2026-02-08', 3000),
  c('OCI-008', 'LAUDIR', 'MG', 'MT', 'PAGO', '2026-03-12', 500),
  c('OCI-009', 'LAUDIR', 'MG', 'MT', '', '2026-03-20', 500),
  c('OCI-010', 'MOLINA', 'SP', 'GO', 'FINALIZADO', '2026-01-30', 0),
  c('OCI-011', 'MOLINA', 'SP', 'GO', 'CANCELADA', '2026-02-28', null),
  c('OCI-012', '', 'MG', 'GO', 'FINALIZADO', '2026-03-30', 1000),
];

/** O histórico. Existe no arquivo real e a leitura atual não o alcança. */
export const CARGAS_2025: readonly CargaCompleta[] = [
  c('OCI-101', 'LINO', 'SP', 'MT', 'FINALIZADO', '2025-06-01', 1000),
  c('OCI-102', 'LINO', 'SP', 'MT', 'FINALIZADO', '2025-06-02', 1000),
  c('OCI-103', 'LAUDIR', 'SP', 'GO', 'PAGO', '2025-07-01', 1000),
  c('OCI-104', 'LAUDIR', 'SP', 'GO', 'PAGO', '2025-07-02', 1000),
  c('OCI-105', 'MOLINA', 'MG', 'MT', 'FINALIZADO', '2025-08-01', 1000),
  c('OCI-106', 'MOLINA', 'MG', 'MT', 'FINALIZADO', '2025-08-02', 1000),
  c('OCI-107', 'DIRCEU', 'MG', 'GO', '', '2025-09-01', 1000),
  c('OCI-108', 'DIRCEU', 'MG', 'GO', 'CANCELADA', '2025-09-02', 1000),
];

/** A linha repetida — mesma OCI da primeira, todos os campos iguais. */
export const LINHA_DUPLICADA: CargaCompleta = c(
  'OCI-001',
  'LINO',
  'SP',
  'MT',
  'FINALIZADO',
  '2026-01-05',
  1000,
);

export const CARGAS_2026_COM_DUPLICATA: readonly CargaCompleta[] = [
  ...CARGAS_2026,
  LINHA_DUPLICADA,
];

/**
 * AS RESPOSTAS, CONTADAS À MÃO. Se alguma constante daqui precisar de código
 * para ser justificada, ela não é oráculo — é eco da implementação.
 */
export const ESPERADO = {
  // — contagem
  linhas_2026: 12,
  linhas_2026_com_duplicata: 13,
  ocis_unicas_2026_com_duplicata: 12,
  linhas_2025: 8,
  linhas_dois_anos: 20,

  // — por motorista (2026)
  cargas_lino_2026: 5,
  cargas_laudir_2026: 4,
  cargas_molina_2026: 2,
  cargas_sem_motorista_2026: 1,
  motoristas_distintos_2026: 3, // LINO, LAUDIR, MOLINA — o vazio não é motorista

  /* — por status normalizado (2026). Contagem: FINALIZADO nas #1,2,6,7,10,12;
     PAGO nas #3,4,8; célula vazia nas #5,9; "CANCELADA" na #11 — que o
     normalizador não conhece e classifica como DESCONHECIDO. Somam 12. */
  finalizado_2026: 6,
  pago_2026: 3,
  sem_status_2026: 2,
  desconhecido_2026: 1,

  // — valores (2026)
  soma_valores_2026: 15000,
  soma_lino_2026: 7000,
  soma_laudir_2026: 7000,
  soma_molina_2026: 0,
  cargas_sem_valor_2026: 1,
  maior_valor_2026: 3000,
  menor_valor_com_dado_2026: 0,

  // — rota / origem / destino (2026)
  rota_sp_mt_2026: 4,
  origem_sp_2026: 7,
  destino_mt_2026: 6,

  // — mês (2026) — o dado existe; o agrupamento, não
  janeiro_2026: 4,
  fevereiro_2026: 4,
  marco_2026: 4,

  // — comparação entre anos
  diferenca_2026_menos_2025: 4, // 12 − 8
} as const;
