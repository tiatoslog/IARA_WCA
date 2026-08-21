/**
 * DIAGNÓSTICO DE UM TURNO COGNITIVO — pega a mensagem CRUA da falha.
 *
 * O boot mostrou que toda rota cognitiva devolve a frase genérica em ~130 ms.
 * `Kernel.mensagemHumanaDeFalha` engole o texto original quando ele parece
 * técnico; o original só existe no evento `FALHA` da telemetria e no stdout do
 * motor. Este arquivo sobe UM motor, manda UMA frase e despeja a saída inteira.
 */
import { ClienteBarramento } from '../campanha/ClienteBarramento';
import { limparMotoresEsquecidos, subirMotor, type MotorVivo } from '../campanha/MotorSandbox';

const arg = (nome: string, padrao: string): string => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const CEREBRO = arg('--cerebro', 'groq');
const PORTA = Number(arg('--porta', '3096'));
const FRASE = arg('--frase', 'O que você consegue fazer?');

await limparMotoresEsquecidos([PORTA]);
let motor: MotorVivo | null = null;
try {
  motor = await subirMotor({ porta: PORTA, rotulo: 'diag', cerebro: CEREBRO, prazo_subida_ms: 60_000 });
  const cliente = new ClienteBarramento({ url: motor.url_ws, id_usuario: 'diag', nome: 'Diagnostico' });

  await cliente.conectar();
  const t = await cliente.dizer(FRASE, 90_000);
  await cliente.fechar();

  console.log('=== RESPOSTA ===');
  console.log(t.resposta);
  console.log(`\nms=${t.ms} rota=${(t.cadeia as any)?.decisao?.rota ?? '?'}`);
  console.log('\n=== SAIDA DO MOTOR ===');
  for (const linha of motor.saida) process.stdout.write(linha);
  console.log('\n=== PACOTES COM "falha"/"erro" ===');
  for (const p of cliente.pacotes) {
    const s = JSON.stringify(p.bruto);
    if (/falha|erro/i.test(s)) console.log(`${p.direcao} ${p.t}ms ${s.slice(0, 900)}`);
  }
} finally {
  if (motor) await motor.encerrar();
}
