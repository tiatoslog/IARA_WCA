# Percepção de tela P0 — medição

Relatório congelado. Números medidos, não estimados. Máquina: Windows 10 Pro
19045, 21/08/2026. Reproduzir com:

```bash
npx tsx scripts/diagnostico/calibrar-percepcao.ts 50
npx tsx scripts/provas/percepcao-ponta-a-ponta.ts
```

---

## 1. Custo da captura

| Medida | Valor |
|---|---|
| Captura + redução a 32×32 cinza | **40,8 ms** média · **96 ms** pico (n=74) |
| Leitura do metadado da janela | ~1 ms depois do `Add-Type` inicial |
| `Add-Type` (uma vez, na subida do helper) | ~200–400 ms |
| Frequência do laço | 1 Hz |
| CPU do helper PowerShell | **2187 ms em 55 s ≈ 4,0% de um núcleo** |
| Memória do helper | 85 MB (medição isolada) · 68,7 MB (prova ponta a ponta) |

Comparação com a captura que já existia (`AgenteLocal.capturarTela`): um processo
`powershell.exe` por quadro, 200–400 ms, mais um PNG no disco do operador. Para
percepção contínua era inviável nas três dimensões, e é por isso que o P0 tem
primitiva própria.

## 2. Calibração do limiar

Duas fases, mesma janela e depois janela trocada.

| Distribuição | n | p50 | p95 | máx |
|---|---|---|---|---|
| **Ruído** (mesma janela: cursor, relógio, rolagem do navegador) | 49 | 0 | 11 | **13** |
| **Sinal** (janela trocada: Chrome → outra aplicação) | 1 | — | — | **18** |

**O primeiro palpite era `6` e a medição o desmentiu:** 6 fica dentro do ruído,
e a IARA falaria sozinha a cada quadro num navegador com conteúdo vivo.

`DISTANCIA_MINIMA_RELEVANTE = 16` — acima do pior ruído observado (13), abaixo do
sinal observado (18).

**A margem é estreita: 5 bits.** É por isso que o limiar não é o único sinal.
`mudouDeJanela` decide sem limiar quando o processo ou o título mudam, e a prova
ponta a ponta confirmou que é ele que pega o caso real (ver §4).

O ruído foi medido no pior caso de propósito — navegador rolando. Numa tela de
ERP parada ele é praticamente zero, e um limiar calibrado no caso fácil é o que
produz alarme falso no dia real.

## 3. Tráfego

| Medida | Valor |
|---|---|
| Um `EventoVisual` no socket | **293 bytes** |
| Prova completa (5 eventos, 47 s) | **1385 bytes** |
| Um PNG de tela cheia, para comparar | > 1 MB |

A razão é ~3.500:1. É a diferença entre um evento por navegação e um screenshot
por segundo subindo da máquina de alguém.

## 4. Prova ponta a ponta

Processo real do Braço, ponte real, WebSocket real, captura real, Bloco de Notas
no lugar do GW.

| Medida | Valor |
|---|---|
| Duração | 47,2 s |
| Eventos recebidos no motor | 5 — `sessao_iniciada`, `mudanca_visual`, `percepcao_suspensa`, `percepcao_retomada`, `sessao_encerrada` |
| Eventos por minuto | 6,4 |
| **Arquivos de imagem criados** | **0** (antes=0, depois=0) |
| Bytes de percepção na rede | 1385 B |
| CPU do processo do Braço | 844 ms em 47,2 s ≈ **1,8% de um núcleo** |
| CPU do helper | 484 ms ≈ **1,0% de um núcleo** |
| Memória: Braço / helper | 73,5 MB / 68,7 MB |
| Eventos depois do `encerrar` | **0** |
| Linhas de indicador visível no console do Braço | 7 |

### O achado que a prova entregou

Foram **seis** digitações no Bloco de Notas e **um** `mudanca_visual`.

Não é defeito: é o limiar funcionando como calibrado. Digitar uma linha muda
pouquíssimos pixels numa miniatura de 32×32 — distância bem abaixo de 16. O
evento que saiu veio do **segundo sinal**: o título da janela virou
`*Sem título — Bloco de Notas` na primeira edição, e identidade de janela não tem
limiar.

**Consequência a registrar, e ela é uma limitação real do P0:** a percepção
detecta MUDANÇA DE TELA, não edição dentro da tela. Preencher um campo do GW sem
navegar provavelmente não gera evento. Isso é P1 (OCR local) e P3 (regiões de
interesse) — não é ajuste de constante, e baixar o limiar para pegar esse caso
traria de volta o alarme falso que a §2 mediu.

## 5. O que a prova NÃO cobriu

- **O GW.** A prova usou o Bloco de Notas. O mecanismo é o mesmo — escopo por
  processo, captura da janela em foco —, mas o comportamento do GW (SPA que não
  muda de título, telas parecidas entre si) só se mede contra o GW.
- **Sessão longa.** 47 s, não 8 h. Vazamento de memória do helper ao longo de um
  turno inteiro é hipótese não testada.
- **Vários monitores.** A captura usa o retângulo da janela em foco, então
  deveria funcionar; não foi medido.
- **O executável empacotado.** A prova rodou o Braço por `tsx`. O helper entra
  por `-EncodedCommand`, sem arquivo, então deve sobreviver ao SEA — mas
  `npm run empacotar:braco` não foi executado nesta rodada.
