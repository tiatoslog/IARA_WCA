/**
 * Stub do contrato Ollama para o E2E da IARA — socket real, porta 30877.
 * /api/tags → 200; /api/chat → stream JSON-por-linha.
 * No modo planejador devolve um plano de passo único; no modo síntese devolve
 * uma resposta fixa em 3 pedaços, com contagens no done.
 * Loga cada requisição no stderr — vira evidência.
 */
import http from 'node:http';

const PORTA = 30877;

const servidor = http.createServer((req, res) => {
  const inicio = new Date().toISOString();
  if (req.url === '/api/tags') {
    console.error(`[stub] ${inicio} GET /api/tags`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }));
    return;
  }
  if (req.url === '/api/chat' && req.method === 'POST') {
    let corpo = '';
    req.on('data', (b) => { corpo += b; });
    req.on('end', () => {
      const pedido = JSON.parse(corpo);
      const ehPlanejador = JSON.stringify(pedido.messages).includes('MODO PLANEJADOR');
      console.error(`[stub] ${inicio} POST /api/chat modelo=${pedido.model} planejador=${ehPlanejador} mensagens=${pedido.messages.length}`);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const linha = (obj) => res.write(`${JSON.stringify(obj)}\n`);
      if (ehPlanejador) {
        linha({ message: { content: '{"objetivo":"responder","passos":[{"descricao":"responder direto","habilidade":null,"parametros":{}}]}' }, done: false });
        linha({ message: { content: '' }, done: true, prompt_eval_count: 210, eval_count: 30 });
        res.end();
        return;
      }
      const pedacos = [
        'Resposta gerada pelo caminho local. ',
        'Estou raciocinando nesta máquina, via Ollama, sem nuvem — ',
        'este texto atravessou percepção, planejamento, provedor local e barramento até a sua tela.',
      ];
      let i = 0;
      const tique = setInterval(() => {
        if (i < pedacos.length) {
          linha({ message: { content: pedacos[i] }, done: false });
          i += 1;
        } else {
          clearInterval(tique);
          linha({ message: { content: '' }, done: true, prompt_eval_count: 480, eval_count: 42 });
          res.end();
        }
      }, 120);
      return;
    });
    return;
  }
  res.writeHead(404).end();
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.error(`[stub] servidor Ollama de teste em http://127.0.0.1:${PORTA}`);
});
