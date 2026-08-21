/**
 * O BRAÇO SE INSTALA — a etapa que nunca existiu.
 *
 * A PROVA DE QUE ELA FALTAVA estava na pasta de Downloads da operadora, em
 * 21/08/2026:
 *
 *     iara-braco.exe       15/08 20:15
 *     iara-braco (1).exe   15/08 21:48
 *     iara-braco (2).exe   15/08 22:10
 *     iara-braco (3).exe   20/08 13:34
 *     iara-braco (4).exe   21/08 08:58
 *
 * Cinco cópias do mesmo programa, numeradas pelo navegador. O sintoma que ela
 * relatou — *"instalo, funciona; no dia seguinte preciso baixar de novo"* — não
 * era um autostart quebrado. A varredura mostrou, nas quatro camadas do Windows
 * (`HKCU\...\Run`, `HKLM\...\Run`, pasta Inicializar, serviços, tarefas
 * agendadas) e no repositório inteiro: **o autostart nunca existiu**. O
 * executável era o produto; abrir o download era a única forma de ligar o braço.
 *
 * ================= O QUE ESTE ARQUIVO É =================
 *
 * A parte PURA da decisão: dado onde o executável está rodando, o que precisa
 * acontecer? Sem tocar disco, sem chamar `schtasks`. Os efeitos moram em
 * `aplicarInstalacao`; a decisão mora aqui, e por isso os casos difíceis —
 * rodar já instalado, rodar de outra pasta, abrir um `.exe` velho esquecido em
 * Downloads — podem ser interrogados por teste em vez de por tentativa.
 *
 * ================= AS TRÊS DECISÕES DE DESENHO =================
 *
 * 1. IDEMPOTENTE, porque a operadora VAI abrir o `.exe` de novo — por hábito,
 *    por dúvida, por clique errado. A segunda execução REPARA. Nunca cria
 *    `braco (1)`: uma pasta numerada seria o mesmo defeito de Downloads, mudado
 *    de lugar.
 *
 * 2. A TAREFA CHAMA O SUPERVISOR, NUNCA O RUNTIME. É o que permite ao
 *    atualizador trocar o runtime sem substituir o executável que o Windows
 *    acabou de iniciar — o antipadrão que `religarComVersaoNova` implementava
 *    com um `.bat` de retry sobre o próprio `process.execPath`.
 *
 * 3. A IDENTIDADE FICA FORA DAQUI. `braco.json` mora em `%APPDATA%\iara\` e
 *    continua lá. Se ela morasse na pasta de instalação, um reparo que limpasse
 *    a pasta apagaria a credencial — e a máquina apareceria para a IARA como um
 *    computador NOVO a cada conserto.
 *
 * ================= POR QUE TAREFA AGENDADA E NÃO SERVIÇO =================
 *
 * Um Windows Service roda na sessão 0, isolada, sem desktop. Duas habilidades
 * que hoje funcionam morreriam ali:
 *
 *     capturar_tela   → `[SystemInformation]::VirtualScreen` fotografa o nada
 *     abrir_aplicativo → o Bloco de Notas abre invisível para a pessoa
 *
 * A escolha não é de preferência: é a única que preserva as capacidades que já
 * existem. Tarefa agendada no logon roda NA SESSÃO INTERATIVA do operador.
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import caminho from 'node:path';
import type path from 'node:path';

/** `%LOCALAPPDATA%\IARA\braco` — um lugar só, sempre o mesmo. */
export const PASTA_PADRAO = 'IARA\\braco';

/**
 * O nome é FIXO e é o que torna a reinstalação idempotente do lado do Windows:
 * `schtasks /create /f` sobre o mesmo nome substitui em vez de somar.
 */
export const NOME_DA_TAREFA = 'IARA-Braco';

export type AcaoDeInstalacao =
  /** Primeira vez nesta máquina. */
  | 'instalar'
  /** Já instalado, mesma versão, e o executável veio de fora: conserta. */
  | 'reparar'
  /** Veio uma versão mais nova: instala ao lado e aponta para ela. */
  | 'atualizar'
  /** Já é ele mesmo rodando de dentro de casa. Não faz nada. */
  | 'ja_instalado'
  /** Um `.exe` velho esquecido em Downloads não rebaixa instalação boa. */
  | 'recusar_downgrade';

export interface PlanoDeInstalacao {
  readonly acao: AcaoDeInstalacao;
  readonly pasta: string;
  readonly versao: string;
  readonly versao_anterior: string | null;
  readonly destino_runtime: string;
  readonly destino_supervisor: string;
  readonly registrar_tarefa: boolean;
  readonly nome_da_tarefa: string;
  readonly alvo_da_tarefa: string;
  /** O que a instalação REMOVE. Vazio quase sempre — ver `BI-10`. */
  readonly apaga: readonly string[];
  /** Uma linha para o log e para a tela. */
  readonly porque: string;
}

/** `1.4.0` > `1.3.9`. Compara número a número, nunca texto. */
export function versaoMaior(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function planoDeInstalacao(entrada: {
  /** `process.execPath` — de onde este processo está rodando AGORA. */
  readonly executavel: string;
  readonly pasta: string;
  readonly versao: string;
  /** A versão que já está instalada, de `atual.json`. `null` = nada instalado. */
  readonly versaoInstalada: string | null;
  /** Injetado para o teste poder falar Windows numa máquina qualquer. */
  readonly separador?: Pick<typeof path, 'join' | 'normalize' | 'sep'>;
}): PlanoDeInstalacao {
  /* `caminho` e nao `require`: este arquivo e ESM, e `require` nao existe aqui.
     A primeira redacao usava `require` e passava nos testes so porque eles
     sempre injetam o separador — em producao teria quebrado na primeira
     instalacao real. */
  const p = entrada.separador ?? caminho;

  const casa = p.normalize(entrada.pasta);
  const destino_supervisor = p.join(casa, 'supervisor.exe');
  const destino_runtime = p.join(casa, 'versoes', entrada.versao, 'iara-braco.exe');

  const base = {
    pasta: casa,
    versao: entrada.versao,
    versao_anterior: entrada.versaoInstalada,
    destino_runtime,
    destino_supervisor,
    nome_da_tarefa: NOME_DA_TAREFA,
    /* SEMPRE o supervisor — ver a decisão 2 do cabeçalho. */
    alvo_da_tarefa: destino_supervisor,
    apaga: [] as readonly string[],
  };

  /**
   * RODANDO DE DENTRO DE CASA é o caso do dia a dia: a tarefa iniciou o
   * supervisor, o supervisor iniciou o runtime, e os dois moram na pasta.
   * Reinstalar aqui seria copiar arquivo sobre si mesmo a cada logon.
   */
  const dentroDeCasa = p
    .normalize(entrada.executavel)
    .toLowerCase()
    .startsWith(casa.toLowerCase());
  if (dentroDeCasa) {
    return {
      ...base,
      acao: 'ja_instalado',
      registrar_tarefa: false,
      porque: 'o programa já está instalado e rodando do lugar dele',
    };
  }

  if (entrada.versaoInstalada === null) {
    return {
      ...base,
      acao: 'instalar',
      registrar_tarefa: true,
      porque: 'primeira instalação nesta máquina',
    };
  }

  if (entrada.versaoInstalada === entrada.versao) {
    /**
     * REPARAR REGISTRA A TAREFA DE NOVO, e isso não é desperdício: a razão mais
     * comum para alguém abrir o `.exe` de novo é justamente porque parou de
     * funcionar — e a tarefa apagada é uma das formas de parar.
     */
    return {
      ...base,
      acao: 'reparar',
      registrar_tarefa: true,
      porque: 'mesma versão já instalada; conferindo os arquivos e a tarefa do Windows',
    };
  }

  if (versaoMaior(entrada.versao, entrada.versaoInstalada)) {
    /* A anterior FICA no disco: é o que torna o rollback possível sem baixar
       nada de novo. */
    return {
      ...base,
      acao: 'atualizar',
      registrar_tarefa: true,
      porque: `atualizando de ${entrada.versaoInstalada} para ${entrada.versao}`,
    };
  }

  return {
    ...base,
    acao: 'recusar_downgrade',
    registrar_tarefa: false,
    porque:
      `este programa é a versão ${entrada.versao} e a máquina já tem a ${entrada.versaoInstalada}. ` +
      'Não rebaixo uma instalação boa — provavelmente é um download antigo.',
  };
}

// ---------------------------------------------------------------------------
// Os efeitos — daqui para baixo se toca no disco e no Windows
// ---------------------------------------------------------------------------

/**
 * A TAREFA VAI EM XML, e a razão foi medida — não escolhida por elegância.
 *
 * A primeira versão usava o atalho do `schtasks`:
 *
 *     schtasks /create /f /tn IARA-Braco /tr "…" /sc onlogon /rl limited
 *
 * Rodando o `.exe` de verdade nesta máquina, em 21/08/2026, ele respondeu
 * **ERRO: Acesso negado** — e o instalador seguiu adiante avisando que o braço
 * não voltaria depois do reboot. Quatro variantes foram sondadas antes de
 * qualquer linha ser alterada, e o resultado isola a causa:
 *
 *     /sc onlogon .............................. Acesso negado
 *     /sc onlogon + /ru <usuário atual> ........ Acesso negado
 *     /sc onlogon + subpasta \IARA\Braco ....... Acesso negado
 *     /sc daily ................................ OK
 *     /create /xml (com LogonTrigger) .......... OK
 *     Register-ScheduledTask (COM, PowerShell) . OK
 *
 * Não é política da máquina, não é falta de administrador e não é a citação do
 * caminho: é o ATALHO `/sc onlogon` do `schtasks.exe` que exige elevação. O
 * mesmo gatilho de logon, declarado em XML, é aceito para o próprio usuário. O
 * XML ainda paga por si: cada default perigoso do Agendador passa a ser uma
 * linha explícita em vez de uma surpresa.
 */
export function xmlDaTarefa(plano: PlanoDeInstalacao, usuario: string): string {
  const t = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  /**
   * Cada `<Settings>` abaixo existe porque o DEFAULT do Agendador do Windows
   * quebraria o braço de um jeito que ninguém associaria à causa:
   *
   * `ExecutionTimeLimit` — o padrão é TRÊS DIAS, e ao fim deles o Windows MATA
   * a tarefa. Um supervisor que deve viver para sempre morreria na quarta-feira
   * de quem ligou o computador no domingo, sem erro nenhum em lugar nenhum.
   * `PT0S` é o valor que significa "sem limite".
   *
   * `DisallowStartIfOnBatteries` / `StopIfGoingOnBatteries` — o padrão dos dois
   * é `true`. Num notebook, isso é literalmente "a IARA não tem mãos fora da
   * tomada", e o sintoma seria intermitente da pior forma: funciona na mesa,
   * some na reunião.
   *
   * `MultipleInstancesPolicy: IgnoreNew` — dois supervisores seriam dois
   * runtimes, dois lugares no limite de dispositivos e duas versões possíveis.
   *
   * `RestartOnFailure` — a rede de segurança EXTERNA. O supervisor reergue o
   * runtime; quem reergue o supervisor é o Windows. Sem isto, um supervisor
   * morto (OOM, kill acidental) deixaria a máquina sem braço até o próximo
   * logon, e a tela mostraria "não conectada aqui" sem nenhuma pista do motivo.
   *
   * `Delay: PT20S` no gatilho — no logon, a placa de rede ainda está subindo.
   * Sem a folga, a primeira tentativa de conexão falha sempre, e o freio do
   * supervisor começa a contar por um problema que não existe.
   *
   * `LogonType: InteractiveToken` — é a linha que faz `capturar_tela` e
   * `abrir_aplicativo` funcionarem. A tarefa roda DENTRO da sessão gráfica do
   * operador. Um serviço do Windows rodaria na sessão 0, onde a captura de tela
   * é preta e não existe área de trabalho para abrir aplicativo nenhum — o
   * motivo de este desenho ser tarefa agendada e não serviço.
   */
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${t('Mantém o braço da IARA de pé nesta máquina.')}</Description>`,
    `    <URI>\\${t(plano.nome_da_tarefa)}</URI>`,
    '  </RegistrationInfo>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${t(usuario)}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <WakeToRun>false</WakeToRun>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>7</Priority>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>',
    '  </Settings>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${t(usuario)}</UserId>`,
    '      <Delay>PT20S</Delay>',
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${t(plano.alvo_da_tarefa)}</Command>`,
    '      <Arguments>--supervisor</Arguments>',
    /**
     * SEM esta linha o Windows usa `%windir%\System32` como diretório de
     * trabalho. Hoje nada no braço depende disso — tudo resolve por
     * `pastaDeInstalacao()` e `tmpdir()`, ambos absolutos —, e é justamente por
     * isso que declarar custa nada agora e evita um defeito caro depois: o dia
     * em que alguém escrever um caminho relativo, ele apontaria para dentro de
     * `System32`, onde a escrita é negada e a mensagem de erro não menciona
     * diretório de trabalho nenhum.
     */
    `      <WorkingDirectory>${t(plano.pasta)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  ].join('\r\n');
}

/**
 * O comando, montado à parte para poder ser conferido sem criar tarefa nenhuma.
 *
 * `/f` é o que torna a reinstalação idempotente do lado do Windows: com o mesmo
 * `/tn`, ele SUBSTITUI em vez de somar uma segunda tarefa.
 */
export function comandoDaTarefa(plano: PlanoDeInstalacao, arquivoXml: string): readonly string[] {
  return ['/create', '/f', '/tn', plano.nome_da_tarefa, '/xml', arquivoXml];
}

/** `COMPUTADOR\daian` — o principal do XML. */
export function usuarioAtual(): string {
  const dominio = process.env.USERDOMAIN ?? process.env.COMPUTERNAME ?? '';
  const nome = process.env.USERNAME ?? '';
  return dominio ? `${dominio}\\${nome}` : nome;
}

/** Onde a instalação mora nesta máquina. */
export function pastaDeInstalacao(): string {
  const base =
    process.env.LOCALAPPDATA ??
    caminho.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'AppData', 'Local');
  return caminho.join(base, 'IARA', 'braco');
}

/** `atual.json` — a versão em uso e a anterior, para o rollback saber para onde voltar. */
export interface EstadoInstalado {
  readonly versao: string;
  readonly versao_anterior: string | null;
  readonly instalado_em: string;
}

export function lerEstadoInstalado(pasta = pastaDeInstalacao()): EstadoInstalado | null {
  try {
    const bruto = readFileSync(caminho.join(pasta, 'atual.json'), 'utf8');
    const j = JSON.parse(bruto) as Partial<EstadoInstalado>;
    return typeof j.versao === 'string' && j.versao !== ''
      ? {
          versao: j.versao,
          versao_anterior: typeof j.versao_anterior === 'string' ? j.versao_anterior : null,
          instalado_em: typeof j.instalado_em === 'string' ? j.instalado_em : '',
        }
      : null;
  } catch {
    /* Não instalado é o caso normal da primeira vez, não erro. */
    return null;
  }
}

/**
 * COPIA OS ARQUIVOS E ESCREVE O ESTADO. Não registra a tarefa — isso é
 * `registrarTarefa`, separado porque falha por motivos diferentes e porque um
 * reparo pode precisar de um sem o outro.
 *
 * A ORDEM IMPORTA: primeiro os arquivos, `atual.json` por último. Um processo
 * morto no meio deixa arquivos a mais e um `atual.json` velho — que é
 * recuperável, porque a próxima execução repara. O contrário deixaria
 * `atual.json` apontando para um runtime que não terminou de copiar.
 */
/**
 * O ARQUIVO JÁ É ESTE? — a pergunta que evita a cópia, e com ela o `EBUSY`.
 *
 * DEFEITO REAL, achado em 21/08/2026 rodando o `.exe` empacotado de verdade,
 * com os 17 testes de unidade verdes ao lado:
 *
 *     Error: EBUSY: resource busy or locked, copyfile
 *       'C:\Users\daian\Downloads\iara-braco (5).exe'
 *       -> '…\IARA\braco\versoes\1.3.0\iara-braco.exe'
 *
 * A operadora abre o `.exe` uma segunda vez — o que a pasta de Downloads dela
 * provou ser hábito, não hipótese —, o plano decide `reparar`, e o reparo tenta
 * sobrescrever o executável que está RODANDO. O Windows o mantém travado, e ela
 * vê uma janela preta com um stack trace do Node.
 *
 * Comparar antes de copiar resolve o caso dominante inteiro: reabrir o MESMO
 * arquivo baixado não precisa copiar nada. Não é otimização — é a diferença
 * entre reparar e quebrar.
 *
 * SHA256 e não tamanho+data: dois builds do mesmo dia têm o mesmo tamanho, e a
 * data de modificação sobrevive a uma cópia. Hash de 82 MB custa ~200 ms, uma
 * vez, no clique.
 */
function mesmoConteudo(a: string, b: string): boolean {
  try {
    const hash = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
    return hash(a) === hash(b);
  } catch {
    /* Destino ausente é o caso normal da primeira instalação, não erro. */
    return false;
  }
}

/**
 * Copia só se precisar, e traduz a recusa do Windows em vez de deixá-la subir
 * como exceção crua. `EBUSY` aqui não é um bug — é o SO dizendo "este programa
 * está em uso", e essa frase é útil quando chega inteira até a pessoa.
 */
function copiarSePreciso(origem: string, destino: string): void {
  if (mesmoConteudo(origem, destino)) return;
  try {
    copyFileSync(origem, destino);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EBUSY') {
      throw new ArquivoEmUso(destino);
    }
    throw e;
  }
}

/** A recusa do Windows, com nome — para o instalador poder explicá-la. */
export class ArquivoEmUso extends Error {
  constructor(readonly arquivo: string) {
    super(`o arquivo ${arquivo} está em uso pelo próprio programa`);
    this.name = 'ArquivoEmUso';
  }
}

export function aplicarInstalacao(plano: PlanoDeInstalacao, executavel: string): void {
  mkdirSync(caminho.dirname(plano.destino_runtime), { recursive: true });
  copiarSePreciso(executavel, plano.destino_runtime);

  /**
   * O SUPERVISOR É UMA CÓPIA DO MESMO BINÁRIO, num caminho FIXO.
   *
   * Mesmo programa, papel decidido por argumento (`--supervisor`). Dois
   * binários diferentes seriam duas coisas para manter em concordância — a
   * doença que `empacotar-braco.ts` já recusou uma vez ao não reescrever o
   * braço em Rust.
   *
   * O caminho fixo é o que permite ao supervisor trocar o runtime sem tocar em
   * si mesmo: são arquivos distintos no disco, e o Windows só tranca o que está
   * em execução.
   */
  copiarSePreciso(executavel, plano.destino_supervisor);

  const estado: EstadoInstalado = {
    versao: plano.versao,
    versao_anterior: plano.acao === 'atualizar' ? plano.versao_anterior : null,
    instalado_em: new Date().toISOString(),
  };
  writeFileSync(caminho.join(plano.pasta, 'atual.json'), JSON.stringify(estado, null, 2), 'utf8');
}

/**
 * Registra a tarefa do Windows. Devolve o motivo da falha, ou `null` quando deu
 * certo — nunca lança: uma instalação que não conseguiu agendar continua
 * utilizável hoje, e a pessoa precisa saber disso em vez de ver um crash.
 */
export function registrarTarefa(plano: PlanoDeInstalacao): string | null {
  /**
   * UTF-16LE COM BOM, e não UTF-8. O `schtasks /xml` recusa qualquer outra
   * codificação com uma mensagem que fala de formato de arquivo e não de
   * codificação — meia hora de investigação pela porta errada. O `﻿` na
   * frente é o BOM.
   */
  const arquivo = caminho.join(tmpdir(), `iara-tarefa-${process.pid}.xml`);
  try {
    writeFileSync(arquivo, '﻿' + xmlDaTarefa(plano, usuarioAtual()), 'utf16le');
    execFileSync('schtasks.exe', comandoDaTarefa(plano, arquivo), {
      stdio: 'pipe',
      windowsHide: true,
    });
    return null;
  } catch (e) {
    const saida = (e as { stderr?: Buffer; message?: string }).stderr?.toString() ?? '';
    return (saida || (e as Error).message || 'schtasks recusou').trim().slice(0, 200);
  } finally {
    /* O XML declara onde o braço mora, não um segredo — mas é lixo em `%TEMP%`
       de qualquer forma, e o `finally` cobre também o caminho de falha. */
    try {
      rmSync(arquivo, { force: true });
    } catch {
      /* melhor esforço */
    }
  }
}

/**
 * JÁ TEM SUPERVISOR DE PÉ? — a pergunta que impede o segundo braço.
 *
 * Sem ela, a operadora que reabre o `.exe` ganha um SEGUNDO supervisor e um
 * segundo runtime: dois processos com a mesma credencial, dois lugares no
 * limite de dispositivos e duas versões possíveis atendendo a mesma pessoa. O
 * `MultipleInstancesPolicy` do XML não cobre isso — ele governa a tarefa
 * agendada, não um duplo clique.
 *
 * O pid SOZINHO não basta: o Windows reusa pid, e um número guardado ontem pode
 * ser o Excel de hoje. O `tasklist` é filtrado por pid E por nome de imagem, e
 * só a coincidência dos dois conta como vivo.
 */
export function supervisorVivo(pasta = pastaDeInstalacao()): number | null {
  try {
    const bruto = readFileSync(caminho.join(pasta, 'supervisor.json'), 'utf8');
    const pid = (JSON.parse(bruto) as { pid_supervisor?: unknown }).pid_supervisor;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;

    const saida = execFileSync(
      'tasklist.exe',
      ['/fi', `PID eq ${pid}`, '/fi', 'IMAGENAME eq supervisor.exe', '/fo', 'csv', '/nh'],
      { stdio: 'pipe', windowsHide: true },
    ).toString();

    /* Sem correspondência o `tasklist` ainda sai com 0 e escreve uma frase de
       "nenhuma tarefa"; o que prova a existência é o pid aparecer na saída. */
    return saida.includes(`"${pid}"`) ? pid : null;
  } catch {
    return null;
  }
}

/** A tarefa existe? Usado pelo reparo e pelo diagnóstico. */
export function tarefaRegistrada(): boolean {
  try {
    execFileSync('schtasks.exe', ['/query', '/tn', NOME_DA_TAREFA], {
      stdio: 'pipe',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
