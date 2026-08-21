# environment.md — reconhecimento do ambiente

> Fase 1 do pipeline. Tudo aqui foi **verificado por execução**, não presumido.
> Data do levantamento: 19/08/2026.

## Sistema

| Item | Valor |
|---|---|
| SO | Windows 10 Pro 19045 |
| Shell | PowerShell 5.1 + Git Bash (POSIX) |
| Node | v24.16.0 |
| npm | 11.13.0 |
| Python | 3.14.5 (`python`) / 3.13.14 (`python3`) |

## Ferramentas — inventário verificado

| Ferramenta | Estado | Como foi verificado | Decisão |
|---|---|---|---|
| FFmpeg | **9.0** (instalado nesta sessão) | `ffmpeg -version` | Instalado via `winget Gyan.FFmpeg`. Era a única ausência essencial. |
| FFprobe | 9.0 | veio no mesmo pacote | QA automatizado de render |
| libx264 / aac | presentes | `ffmpeg -encoders` | H.264 + AAC conforme spec |
| Pillow | **12.2.0** | `import PIL` | Composição de quadros 1080p, crop, máscara, seta |
| Playwright | 1.62.1 (devDep) | `package.json` | **Não usado** — ver "captura" abaixo |
| msedge-tts | **2.0.7** (dep do projeto) | síntese real executada | Narração neural pt-BR |
| ImageMagick | ausente | `magick` | **Não instalado** — Pillow cobre o caso |
| Convai TTS | indisponível | `CONVAI_API_KEY` ausente | Não usado; o neural grátis atende |

**Regra seguida:** usar o que existe antes de instalar. Uma única dependência
nova foi adicionada (FFmpeg), porque sem encoder não há vídeo.

## Capacidade de áudio e TTS

Voz da IARA já é **canônica no projeto**, não uma escolha desta produção:

```
servidor/nucleo/Voz.ts:8
  `pt-BR-FranciscaNeural` (feminina — identidade da IARA, inegociável)
```

- Provedor: vozes neurais do Edge, via `msedge-tts`. Gratuito, sem chave.
- Sonda executada: 22.032 bytes de MP3 para uma frase de teste → o serviço responde.
- Formato: `AUDIO_24KHZ_48KBITRATE_MONO_MP3`.
- Qualidade: **neural**, não SAPI. A voz SAPI local (`Microsoft Maria Desktop`)
  foi descartada por soar sintética — o briefing exige voz não-robótica.

**Honestidade sobre privacidade (herdada do projeto, `Voz.ts:13`):** o provedor
neural envia o *texto da narração* ao serviço da Microsoft — o mesmo que o Edge
faz com uma voz "Natural". Consequência prática assumida nesta produção: **o
roteiro narrado não contém nome de pessoa, telefone, e-mail nem número de
documento real.** O que é sensível aparece só como imagem, e mascarado.

## Capacidade de captura

O procedimento IT-ADMLUFT-001 roda em **Excel + Outlook + pasta de rede**, não
em aplicação web. Consequências:

- **Playwright não se aplica.** Não há navegador a dirigir; usá-lo aqui seria
  encenação, não captura.
- **Não há ambiente real acessível** para gravar: as planilhas vivem em caminho
  de rede corporativo e contêm dados de produção.
- **Existem 8 capturas reais** já extraídas do POP, em `public/procedimentos/IT-ADMLUFT-001/`.
  São capturas legítimas do sistema real, feitas por quem escreveu o POP.

**Decisão:** usar as capturas reais do POP, tratadas (crop, zoom, máscara,
destaque). Nenhuma interface é recriada ou simulada — conforme §15 do briefing.
Onde a captura não permite afirmar algo, o vídeo não afirma.

## Resolução e composição

| Item | Valor |
|---|---|
| Master | 1920×1080, 16:9, 30 fps |
| Celular | 1080×1920, 9:16, 30 fps |
| Codec | H.264 (libx264) / AAC |
| Maior captura disponível | 1284×398 px |
| Menor captura disponível | 419×138 px |

**Limitação real:** as capturas são **faixas largas e baixas** (recortes de
planilha), não telas cheias. Nenhuma chega perto de 1080p de altura. Ampliar
para tela cheia geraria interpolação borrada.
**Tratamento adotado:** a captura ocupa uma faixa central em escala ≤2× com
interpolação Lanczos, sobre fundo da identidade, com zoom em região de interesse
quando o passo aponta para um campo específico. Legibilidade acima de tamanho.

## Fontes

Nenhum arquivo `.ttf`/`.otf` no repositório. A família do produto é **Inter**,
carregada por `next/font` no app web — não existe como arquivo local.
**Decisão:** o renderizador usa Inter se encontrar no sistema; senão cai para
Segoe UI Variable / Segoe UI, que são metricamente próximas e nativas do
Windows. Documentado em `style-guide.md`.

## Assets encontrados

| Asset | Onde | Uso nesta produção |
|---|---|---|
| 8 capturas reais do POP 001 | `public/procedimentos/IT-ADMLUFT-001/` | **Sim** — base visual |
| Paleta e regras de identidade | `app/globals.css` | **Sim** — herdadas |
| Modelo 3D da IARA | `ativos/identidade_iara/source.glb` | **Não** — ver abaixo |
| MetaHuman (Hannah) | `arquivos/identidade-metahuman/` | **Não** — fora do Git por licença |
| Packs de pixel art | `arquivos/packs-arte/` | **Não** — é o escritório, não o treinamento |
| Áudio / música | **inexistente** | Ver limitações |
| Vídeo existente | **inexistente** | — |

**Sobre o avatar:** o `.glb` e o MetaHuman exigiriam pipeline de render 3D
(R3F headless ou Unreal) que não existe nesta máquina. §14 do briefing manda a
IARA aparecer **só quando agrega valor** e proíbe mascote onipresente — então a
presença da IARA neste vídeo é **tipográfica e sonora** (voz Francisca +
assinatura de marca), não um avatar renderizado. Decisão documentada, não
omissão silenciosa.

## Limitações conhecidas

1. **Sem trilha musical.** Não há biblioteca de áudio licenciada no projeto, e
   §"Arte" do CLAUDE.md exige checar licença comercial antes de qualquer asset
   novo. Baixar música de terceiro sem verificar licença seria violar isso.
   O mix é entregue **voz + sound design sintetizado proceduralmente** (gerado
   por síntese, sem licença de terceiro). Ponto para revisão humana.
2. **Capturas de baixa altura** — ver "Resolução".
3. **Dados de exemplo das capturas são de 2022**, enquanto o POP é de 2025.
   Inconsistência visual do material de origem, registrada em `pop-audit.md`.
4. **Voz neural envia texto à Microsoft** — mitigado por não narrar dado pessoal.
5. **Sem ambiente real do GW** para captura nova. O POP 001 nem toca o GW; os
   POPs que tocam (002+) precisariam de acesso ao sistema.
