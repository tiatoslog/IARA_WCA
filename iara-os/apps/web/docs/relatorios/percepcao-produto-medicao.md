# Percepção como produto — medição

Relatório congelado. Continuação de `percepcao-p0-medicao.md`. Máquina:
Windows 10 Pro 19045, 21/08/2026. Reproduzir com:

```bash
npx tsx scripts/diagnostico/sondar-ocr.ts
npx tsx scripts/diagnostico/calibrar-percepcao.ts 25 --texto
npm run empacotar:braco
```

E a prova de produto, com o Braço empacotado:

```bash
npx tsx scripts/provas/percepcao-ponta-a-ponta.ts
```

---

## 1. O que mudou de P0 para produto

| | P0 | Produto |
|---|---|---|
| Quem liga | um script escrevendo pacote no socket | a **frase do operador** → âncora → receita → `observar_tela` |
| Consentimento | prompt no console do Braço | **na conversa**, e o Braço não pergunta de novo |
| Kill switch | não existia | `"para de observar"` → encerra local + manda o Braço parar |
| Teto de sessão | não existia | 30 min, com relógio nos **dois** lados |
| Queda de rede | eventos se perdiam em silêncio | 3 falhas de envio **encerram** a sessão |
| Texto da tela | nenhum | OCR local + máscara na origem |
| Mudança interna | invisível | detectada por diferença de linhas de texto |
| Estado | `ativa`/`suspensa` (booleanos) | uma máquina de 5 estados; `encerrada` não revive |

## 2. OCR local

Motor: `Windows.Media.Ocr`, do próprio Windows. **Zero dependência nova** — a
alternativa avaliada (`tesseract.js`) teria entrado no pacote do Braço.

| Medida | Valor |
|---|---|
| Disponível nesta máquina | sim, `pt-BR` |
| Primeira leitura (carrega o motor) | 460 ms |
| Leituras seguintes | **118 ms** média, 139 ms pico (n=25) |
| Linhas devolvidas numa janela real (Chrome 1382×744) | 22–23 |
| Intervalo do laço | 5 s (não a cada quadro) |

**Onde o bitmap vive:** dentro do processo do helper PowerShell, serializado
para um `MemoryStream`, entregue ao OCR e descartado na mesma função. O que
atravessa o cano são linhas de texto. Nenhum arquivo.

## 3. Calibração do texto

`calibrar-percepcao.ts 25 --texto`, janela parada de verdade:

| Distribuição | n | min | p50 | p95 | máx |
|---|---|---|---|---|---|
| Ruído do OCR (linhas que entram + saem) | 25 | 0 | 0 | 0 | **0** |

**O OCR do Windows não oscila sozinho numa tela estática.** Eu esperava ver a
troca de `l` por `I` aparecer no ruído; não apareceu. `MIN_LINHAS_MUDADAS = 2`
fica com folga acima de zero.

Consequência registrada no código: como a contagem é simétrica, **uma linha cujo
conteúdo muda soma 2 e dispara** — que é exatamente o caso do campo preenchido no
GW. Uma linha que só aparece soma 1 e não dispara.

## 4. Prova de produto com o Braço EMPACOTADO

`npm run empacotar:braco` → `iara-braco.exe`, 89 MB,
SHA256 `80d0e2d4c6a61987ce98646fa57bb96d41e78ae3bb34aac9f7c94ac3d9bef492`.

A prova rodou o `.exe`, não o código-fonte. Conversa observada nos logs:

```
[operador] me acompanha fazendo esse procedimento
[plano] origem=deterministico habilidade=observar_tela {"acao":"solicitar"}
[iara] Posso acompanhar sua tela enquanto você trabalha.

[operador] pode observar o cmd
[plano] origem=deterministico habilidade=observar_tela {"acao":"autorizar","aplicativo":"cmd"}
[iara] Combinado. Vou acompanhar **cmd** a partir de agora.
[braço] (o) PERCEPCAO ATIVA — observando cmd

[operador] você está vendo minha tela?
[iara] Sim — estou acompanhando **cmd** neste computador (disp-1), desde 17:0x.

[operador] para de observar
[iara] Parei de acompanhar sua tela.
[braço] ==== PERCEPCAO DE TELA DESLIGADA ====
```

| Medida (executável empacotado) | Valor |
|---|---|
| Duração | 37,4 s |
| Eventos no motor | **5** — `sessao_iniciada`, **`mudanca_visual` × 2**, `percepcao_suspensa`, `sessao_encerrada` |
| Tráfego de percepção | 1869 B (≈ 374 B por evento) |
| Eventos por minuto | 8,0 |
| **Arquivos de imagem criados** | **0** |
| CPU do Braço | 328 ms em 37,4 s ≈ **0,9% de um núcleo** |
| Memória do Braço | 118,6 MB |
| **Eventos depois do "para de observar"** | **0** |
| **Perguntas no console do Braço** | **0** (o consentimento veio da conversa) |
| Linhas de indicador no Braço | 6 |
| Estado final | `encerrada`, 2 mudanças registradas |

A janela observada nesta rodada foi `whatsapp.root`: o Windows não deixou o
Bloco de Notas tomar o foco, e a prova seguiu com a janela que estava lá. As duas
mudanças detectadas vieram do conteúdo real dessa janela mudando, e atravessaram
o socket até virar `EstadoVisual` no motor.

**Duas rodadas, duas coberturas.** A primeira (escopo `cmd`) não produziu
`mudanca_visual` — a janela perdeu o foco e não voltou — e provou a suspensão por
escopo. A segunda produziu as duas mudanças. Juntas cobrem o ciclo inteiro com o
binário empacotado.

## 5. Custo acumulado da percepção ligada

Somando as medições: helper (~4% de um núcleo a 1 Hz com captura) + OCR a cada
5 s (118 ms) + Braço (~1%). **Ordem de 5% de um núcleo**, com ~300 B por evento e
poucos eventos por minuto.

## 6. O que continua não medido

- **O GW real.** Todas as provas usaram Bloco de Notas, Chrome e `cmd`.
- **Sessão longa.** A mais longa foi 47 s. Vazamento de memória do helper ao
  longo de 8 h é hipótese não testada.
- **Vários monitores.** A captura usa o retângulo da janela em foco, então
  deveria funcionar; não foi medido.
- **Queda de rede real.** O caminho de 3 falhas → encerra existe no código e não
  foi exercitado derrubando o socket de verdade.
