/**
 * O ORÁCULO NOVO, CONTRA O WINDOWS DE VERDADE.
 *
 * Os testes de unidade injetam a sonda de janelas — eles provam a DECISÃO e
 * não provam nada sobre o PowerShell que a sonda real executa. O risco da
 * troca de oráculo é simétrico ao defeito que ela corrige: se a enumeração
 * falhar em silêncio, toda abertura legítima passa a ser reprovada, e a IARA
 * troca "menti que abri" por "não sei abrir nada".
 *
 * Este arquivo exercita o caminho real, com `AgenteLocal` construído sem
 * nenhum dublê.
 */

import { AgenteLocal } from '../../servidor/nucleo/AgenteLocal';
import { execFileSync } from 'node:child_process';

function matarNotepads(): void {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'notepad.exe'], { stdio: 'ignore' });
  } catch {
    /* nenhum rodando é o caso normal */
  }
  try {
    execFileSync('taskkill', ['/F', '/IM', 'Notepad.exe'], { stdio: 'ignore' });
  } catch {
    /* idem */
  }
}

async function principal(): Promise<void> {
  const agente = new AgenteLocal();

  console.log('=== CASO 1: nada aberto — a abertura tem de ser CONFIRMADA ===');
  matarNotepads();
  await new Promise((r) => setTimeout(r, 2500));
  const t0 = Date.now();
  const r1 = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  console.log(`   levou ${Date.now() - t0} ms`);
  console.log('   ok:', r1.ok);
  console.log('   confirmado:', r1.prova.confirmado, '| motivo:', r1.prova.motivo ?? '(nenhum)');
  console.log('   codigo_erro:', r1.codigo_erro);
  console.log('   evidencia:', r1.prova.evidencia);
  console.log('   texto:', r1.texto);
  console.log('');

  console.log('=== CASO 2: já aberto — tem de virar RESSALVA, nunca sucesso provado ===');
  const t1 = Date.now();
  const r2 = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  console.log(`   levou ${Date.now() - t1} ms`);
  console.log('   ok:', r2.ok);
  console.log('   confirmado:', r2.prova.confirmado, '| motivo:', r2.prova.motivo ?? '(nenhum)');
  console.log('   evidencia:', r2.prova.evidencia);
  console.log('   texto:', r2.texto);
  console.log('');

  matarNotepads();

  console.log('=== VEREDITO ===');
  const caso1 = r1.prova.confirmado === true;
  const caso2 = r2.prova.confirmado === false && r2.prova.motivo === 'sem_meio_de_verificar';
  console.log('   caso 1 (abriu e provou):', caso1 ? 'PASS' : 'FAIL');
  console.log('   caso 2 (já aberto, ressalva):', caso2 ? 'PASS' : 'FAIL');
  if (!caso1) {
    console.log('   ATENÇÃO: o oráculo novo reprovou uma abertura legítima — falso negativo.');
  }
}

void principal();
