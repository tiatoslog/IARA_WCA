# Sandbox do agente de código

Fecha os três vetores que `testes/escape-sandbox-adversarial.test.ts` mede
abertos no modo padrão (spawn direto no host). **Desligado por padrão** — ligar
muda o produto, não só o endurecimento: o agente passa a rodar em Linux, sobre o
repositório montado, com outro conjunto de ferramentas disponível.

## Por que não `--network=none`

Seria mais simples e fecharia ES-03 no papel. Mas o agente real precisa alcançar
a API da Anthropic: um container sem rede quebra o produto e — pior — faria a
bateria passar numa configuração que a produção não pode rodar. A allowlist
fecha o vetor **sem** desligar o agente.

## Montar

```bash
docker network create --internal iara-agente-interna
docker build -f Dockerfile.proxy -t iara-proxy-allowlist .
docker run -d --name iara-proxy --network iara-agente-interna iara-proxy-allowlist
docker network connect bridge iara-proxy
```

O proxy fica nas **duas** redes: é a única ponte para fora, e é por isso que ele
consegue ser o ponto onde a allowlist se aplica.

A imagem do agente (`IARA_AGENTE_IMAGEM`) não está aqui: ela carrega o
`@anthropic-ai/claude-code` e as credenciais, e essas são decisões de quem
instala.

## Ligar

```
IARA_AGENTE_SANDBOX=container
IARA_AGENTE_IMAGEM=<a imagem com o agente>
IARA_AGENTE_REDE=iara-agente-interna
IARA_AGENTE_PROXY=http://iara-proxy:8888
```

## Medido em 18/08/2026 — Docker 29.5.2, containers Linux

| vetor | modo padrão | com sandbox |
|---|---|---|
| ES-02 leitura fora do repositório | lê por caminho relativo **e** absoluto | falha nos dois |
| ES-04 escrita fora do repositório | planta arquivo na pasta-mãe | cai na camada efêmera, host intocado |
| ES-03 egresso irrestrito | alcança servidor arbitrário | `403 Filtered`; sem proxy o nome nem resolve |

Controle do egresso, na mesma rodada: `api.anthropic.com` respondeu HTTP 400 —
o agente continua alcançando a API.

`testes/escape-sandbox-container.test.ts` mede isto continuamente e importa
`argumentosDeContainer` de `AgenteLocal.ts`, nunca uma réplica. Ele **pula**
declarando o motivo quando o daemon está fora do ar: "não consegui medir" não
pode virar "está contido".

## A armadilha que quase entrou

A sonda de rede do harness antigo busca `http://127.0.0.1:<porta>` num servidor
do host. Dentro de um container, `127.0.0.1` é o loopback **do container**, e o
servidor do host fica inalcançável por namespace — não por contenção. Um
container na rede padrão alcança `https://api.anthropic.com` sem controle nenhum
**e** falha nesse `127.0.0.1`. Reaproveitar aquela sonda daria "ES-03 fechado"
com a internet inteira aberta. Por isso CT-03 mede destino externo real e carrega
controle positivo na rede padrão.
