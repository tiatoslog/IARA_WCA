/**
 * ONDE SE DECIDE O QUE A GAVETA "INSTALAR A IARA" OFERECE.
 *
 * A instalação de um PWA não tem botão universal: o Chrome entrega um evento
 * (`beforeinstallprompt`) que a página pode disparar quando quiser; o iOS não
 * entrega nada e só o Safari instala, pelo menu Compartilhar; os demais
 * navegadores têm a opção escondida no próprio menu. Oferecer o gesto errado
 * na plataforma errada é pior que não oferecer nada — é um botão que mente.
 *
 * Por isso a decisão é UMA função pura, aqui, longe do DOM: ela recebe os três
 * fatos que importam e devolve o único estado possível. O componente não
 * decide nada — só traduz o estado em texto e botão. E por ser pura, a tabela
 * de decisão inteira roda no node:test, sem navegador.
 */

/** O que a gaveta pode oferecer, um estado de cada vez. */
export type EstadoInstalacao =
  /** Já está rodando instalada (standalone) — só confirmar, nunca reoferecer. */
  | 'instalada'
  /** O navegador entregou o convite: temos um botão de verdade para mostrar. */
  | 'pronta'
  /** iPhone/iPad no Safari: o caminho é Compartilhar → Adicionar à Tela de Início. */
  | 'ios_safari'
  /** iPhone/iPad fora do Safari: nenhum navegador iOS além dele instala. */
  | 'ios_navegador'
  /** Navegador de computador sem o convite: resta apontar o menu do próprio navegador. */
  | 'manual';

/** Os três fatos de que a decisão depende — colhidos pelo hook, no cliente. */
export interface ContextoInstalacao {
  /** `navigator.userAgent`. */
  ua: string;
  /** `display-mode: standalone` OU `navigator.standalone` (iOS). */
  standalone: boolean;
  /** Existe um `beforeinstallprompt` capturado e ainda não gasto. */
  promptCapturado: boolean;
  /** `navigator.maxTouchPoints` — o iPad moderno se apresenta como Macintosh
   *  e só os toques o denunciam. */
  toques: number;
}

/**
 * iPhone e iPod se dizem quem são. O iPad desde o iPadOS 13 se apresenta como
 * "Macintosh", e a única diferença observável para um Mac de verdade é a tela
 * de toque — nenhum Mac reporta mais de um ponto de toque.
 */
function ehIos(ua: string, toques: number): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && toques > 1;
}

/**
 * Todo navegador no iOS é WebKit, mas só o Safari instala PWA. Os outros se
 * denunciam no UA: Chrome é "CriOS", Firefox "FxiOS", Edge "EdgiOS", Opera
 * "OPiOS". Sem nenhuma dessas marcas, é o Safari.
 */
function ehSafariNoIos(ua: string): boolean {
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Brave/i.test(ua);
}

/** A tabela de decisão inteira. A ordem importa: instalada vence tudo —
 *  reoferecer instalação dentro do app instalado é a única resposta sempre
 *  errada em qualquer plataforma. */
export function classificarInstalacao(ctx: ContextoInstalacao): EstadoInstalacao {
  if (ctx.standalone) return 'instalada';
  if (ehIos(ctx.ua, ctx.toques)) {
    return ehSafariNoIos(ctx.ua) ? 'ios_safari' : 'ios_navegador';
  }
  if (ctx.promptCapturado) return 'pronta';
  return 'manual';
}
