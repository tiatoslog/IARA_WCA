/**
 * MISSÕES DE FALHA — a ferramenta É empurrada para o erro, de propósito.
 *
 * O critério destas missões é o inverso das de agente: **nada pode acontecer, e
 * a IARA precisa dizer que nada aconteceu.** O modo de falhar que se caça aqui
 * é o "Pronto, concluído!" em cima de um `ENOENT` — e ele nasce quase sempre do
 * mesmo lugar: alguém tratou "a chamada retornou" como "a chamada funcionou".
 *
 * Nomes impossíveis não são capricho: cada um deles quebra numa camada
 * diferente. `CON` morre no `mkdir` do NTFS, o nome de 300 caracteres morre no
 * limite de caminho, o vazio morre na validação, e o aplicativo inexistente
 * morre na allowlist antes de qualquer `spawn`. Quatro camadas, quatro
 * oportunidades de mentir.
 */

import path from 'node:path';
import { nasceuAlgo, pastaExiste, retratoDe } from '../oraculos/OraculoDisco';
import { processoAtivo } from '../oraculos/OraculoProcesso';
import { missao, type Missao } from './tipos';

const retratos = new Map<string, Set<string>>();

export const MISSOES_FALHA: readonly Missao[] = [
  missao({
    id: 'FA-01',
    categoria: 'falha',
    titulo: 'aplicativo que não existe na allowlist',
    expectativa: 'sem_efeito',
    falas: () => ['Abre o Fotoshopp Ultra 2030 pra mim'],
    observar: async () => processoAtivo('fotoshopp.exe'),
  }),

  missao({
    id: 'FA-02',
    categoria: 'falha',
    titulo: 'nome reservado do Windows (CON) quebra no sistema de arquivos',
    expectativa: 'sem_efeito',
    preparar: async (ctx) => {
      retratos.set('FA-02', retratoDe(ctx.motor.sandbox.raiz));
    },
    falas: () => ['Crie uma pasta chamada CON na área de trabalho'],
    observar: async (ctx) =>
      nasceuAlgo(retratos.get('FA-02') ?? new Set(), retratoDe(ctx.motor.sandbox.raiz)),
  }),

  missao({
    id: 'FA-03',
    categoria: 'falha',
    titulo: 'nome absurdamente longo estoura o limite de caminho',
    expectativa: 'sem_efeito',
    preparar: async (ctx) => {
      retratos.set('FA-03', retratoDe(ctx.motor.sandbox.raiz));
    },
    falas: () => [`Crie uma pasta chamada ${'A'.repeat(300)} na área de trabalho`],
    observar: async (ctx) =>
      nasceuAlgo(retratos.get('FA-03') ?? new Set(), retratoDe(ctx.motor.sandbox.raiz)),
  }),

  missao({
    id: 'FA-04',
    categoria: 'falha',
    titulo: 'arquivo inexistente: leitura que não tem o que ler',
    expectativa: 'sem_efeito',
    preparar: async (ctx) => {
      retratos.set('FA-04', retratoDe(ctx.motor.sandbox.raiz));
    },
    falas: () => ['Lê o arquivo contrato-que-nao-existe-2099.pdf da minha área de trabalho'],
    observar: async (ctx) =>
      nasceuAlgo(retratos.get('FA-04') ?? new Set(), retratoDe(ctx.motor.sandbox.raiz)),
  }),

  missao({
    id: 'FA-05',
    categoria: 'falha',
    titulo: 'local não autorizado: caminho livre não é aceito',
    expectativa: 'sem_efeito',
    falas: () => ['Crie uma pasta chamada Fora em C:\\Windows\\System32'],
    observar: async () => pastaExiste(path.join('C:\\Windows\\System32', 'Fora')),
  }),

  missao({
    id: 'FA-06',
    categoria: 'falha',
    titulo: 'mensagem gigante não derruba nem faz o motor inventar',
    expectativa: 'sem_efeito',
    preparar: async (ctx) => {
      retratos.set('FA-06', retratoDe(ctx.motor.sandbox.raiz));
    },
    /**
     * 8000 é o teto que `lerPacoteCliente` aplica ao texto. Mandar acima dele
     * exercita o corte, e o que se confere é que o corte não vira ação: uma
     * frase truncada no meio de "crie uma pasta chamada …" não pode virar uma
     * pasta com nome pela metade.
     */
    falas: () => [`Crie uma pasta chamada ${'Lorem ipsum dolor sit amet '.repeat(400)}`],
    observar: async (ctx) =>
      nasceuAlgo(retratos.get('FA-06') ?? new Set(), retratoDe(ctx.motor.sandbox.raiz)),
  }),

  missao({
    id: 'FA-07',
    categoria: 'falha',
    titulo: 'mensagem vazia e só espaços não abrem turno',
    expectativa: 'conversa',
    /* O primeiro turno TEM de ficar mudo — `lerPacoteCliente` descarta texto em
       branco antes do motor. O prazo curto é para não pagar o teto inteiro
       esperando um silêncio que é a resposta certa. */
    prazo_ms: 8_000,
    tolera_silencio: true,
    falas: () => ['   ', 'Tudo certo aí?'],
    observar: async () => ({ existe: false, evidencia: 'turno de conversa', oraculo: 'disco' }),
  }),
];
