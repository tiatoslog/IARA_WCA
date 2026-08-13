/**
 * O CELULAR. Fala com o motor exatamente como a interface web falaria — mesmo
 * WebSocket, mesmo protocolo, mesma apresentação. Nada aqui conhece o braço,
 * a ponte, ou o computador de destino: é uma pessoa digitando uma frase.
 */
import WebSocket from 'ws';

const URL = process.env.MOTOR ?? 'ws://localhost:3000/barramento';
const USUARIO = process.env.USUARIO ?? 'daiane';
const FRASES = process.argv.slice(2);

const ws = new WebSocket(URL, { headers: { Origin: 'http://localhost:3000' } });
let indice = 0;
let ocioso = null;

/**
 * A pessoa só fala de novo DEPOIS de a IARA responder.
 *
 * A primeira versão avançava ao ver `estagio: ocioso`, e isso derrubava a
 * própria medição: o estágio passa por ocioso enquanto a execução ainda corre
 * no braço, então o cliente mandava a frase seguinte (preemptando o turno) ou
 * fechava o socket (cancelando-o) no meio de uma ação que já tinha saído para o
 * computador. O kernel relatou isso corretamente — "Turno interrompido DEPOIS
 * de executar; a resposta foi descartada, o efeito não" —, que é o
 * comportamento certo dele e o comportamento errado de um celular.
 */
let esperando = false;

function proxima() {
  if (indice >= FRASES.length) {
    setTimeout(() => { ws.close(); process.exit(0); }, 1500);
    return;
  }
  const texto = FRASES[indice++];
  esperando = true;
  console.log(`\n>>> CELULAR: ${texto}`);
  ws.send(JSON.stringify({ tipo: 'mensagem', texto }));
}

ws.on('open', () => {
  ws.send(JSON.stringify({ tipo: 'ola', id_usuario: USUARIO, nome: 'Daiane' }));
  setTimeout(proxima, 1200);
});

ws.on('message', (dado) => {
  const p = JSON.parse(dado.toString());
  if (p.tipo === 'erro') { console.log(`!!! ERRO: ${p.texto}`); return; }
  if (p.tipo === 'log') { if (p.nivel !== 'traco') console.log(`    [log ${p.nivel}] ${p.texto}`); return; }
  if (p.tipo !== 'snapshot') return;

  const s = p.snapshot;
  if (s.fala && s.fala.concluida && s.fala.texto !== ultima) {
    ultima = s.fala.texto;
    console.log(`<<< IARA: ${s.fala.texto}`);
    // Só a resposta CONCLUÍDA libera a próxima frase.
    if (esperando) {
      esperando = false;
      clearTimeout(ocioso);
      ocioso = setTimeout(proxima, 1200);
    }
  }
});

let ultima = null;
ws.on('error', (e) => { console.error('erro de socket:', e.message); process.exit(1); });
ws.on('close', (c, m) => console.log(`(socket fechado ${c} ${m})`));
