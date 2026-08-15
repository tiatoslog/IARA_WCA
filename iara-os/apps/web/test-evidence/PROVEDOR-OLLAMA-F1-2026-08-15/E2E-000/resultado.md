# E2E-000 — chave Anthropic real (caminho nuvem intacto)

Executado 15/08/2026, motor de QA na porta 3057 com a chave real do .env.local
(única variável NÃO apagada do ambiente limpo), navegador da sessão como
usuário real. Custo: 4 turnos de nuvem.

## Resultado — PASSOU

1. Cabeçalho SEM aviso nenhum (origem `nuvem` → nenhum banner). ✓
2. Diagnóstico: "● Raciocínio  ONLINE  chave da nuvem válida". ✓
3. Pergunta aberta respondida pela nuvem, em prosa da persona:
   USUÁRIO: "Em uma frase: qual a diferença entre logística e cadeia de
   suprimentos?" → IARA: "Logística é a execução do fluxo físico — transporte,
   armazenagem, entrega; cadeia de suprimentos é o desenho e a coordenação de
   tudo o que cerca esse fluxo, do fornecedor ao cliente final, incluindo
   compras, informação e planejamento." ✓

## Observação de comportamento (não é defeito da camada de provedor)

O shard da operadora `daiane` persiste entre cenários de QA (dados/ locais).
No primeiro turno deste cenário a nuvem JÁ estava ativa, mas o modelo — vendo
no histórico a própria fala anterior "camada de raciocínio desligada" (do
E2E-001) — respondeu em coerência com o histórico: "Mesma barreira do turno
anterior...". Ao ser contestado ("a chave foi reconfigurada"), aplicou a regra
da persona "fato é medido, não afirmado": recusou confirmar pela palavra do
usuário, pediu o diagnóstico, e só respondeu a pergunta depois de o
diagnóstico voltar ONLINE. Comportamento íntegro de ponta a ponta; registrado
como característica (histórico compartilhado entre execuções de QA no mesmo
shard), com a transcrição completa preservada.

Texto integral da página preservado via get_page_text na transcrição.
