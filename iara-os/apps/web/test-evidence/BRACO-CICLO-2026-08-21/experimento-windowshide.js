// EXPERIMENTO CONTROLADO: `windowsHide` esconde a janela de um app grafico?
//
// Reproduz a chamada EXATA de `lancadorReal` (AgenteLocal.ts:970) e a mesma
// chamada sem a flag. Roda por tarefa agendada, na sessao 1, nas mesmas
// condicoes do braco. Uma variavel muda; todo o resto e identico.

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const LOG = 'C:\\Users\\daian\\Desktop\\IARA\\IARA_WCA\\iara-os\\apps\\web\\test-evidence\\BRACO-CICLO-2026-08-21\\GATE-06-experimento.txt';
const linhas = [];
const W = (t) => linhas.push(t);

W('EXPERIMENTO windowsHide - ' + new Date().toISOString());
W('sessao deste processo: ver o relatorio de janelas');
W('');

function lancar(rotulo, opcoes) {
  try {
    const filho = spawn('notepad.exe', [], opcoes);
    W(`${rotulo}: spawn ok, pid=${filho.pid}, opcoes=${JSON.stringify(opcoes)}`);
    filho.unref();
    return filho.pid;
  } catch (e) {
    W(`${rotulo}: spawn FALHOU - ${e.message}`);
    return null;
  }
}

// A: exatamente como o braco faz hoje
const pidA = lancar('A (como o braco faz hoje)', { detached: true, stdio: 'ignore', windowsHide: true });

// B: a mesma coisa, sem a flag
const pidB = lancar('B (sem windowsHide)', { detached: true, stdio: 'ignore', windowsHide: false });

W('');
W(`pid_A=${pidA}`);
W(`pid_B=${pidB}`);
W('');
W('Espere o relatorio de janelas para saber qual das duas criou janela.');

fs.writeFileSync(LOG, linhas.join('\r\n'), 'utf8');
