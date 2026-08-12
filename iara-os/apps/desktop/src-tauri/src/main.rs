// Sem console preto atrás do app em release. Em debug o console fica: é onde
// os avisos de "não alcancei a IARA" aparecem durante o desenvolvimento.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Shell desktop da IARA — Tauri 2.
//!
//! CASCA FINA. Até 12/08/2026 este processo subia um motor Node completo na
//! máquina do operador: Next, tsx transpilando TypeScript em runtime, o
//! WebSocket e o ciclo cognitivo, tudo por pessoa. Era o sistema inteiro
//! instalado em cada computador, e é de onde vinha a máquina ficar lenta.
//!
//! Agora o motor mora na nuvem e este processo é o que sempre deveria ter sido:
//! uma janela. Ele abre o webview no endereço da IARA, mantém a bolha, a
//! bandeja e o Alt+Space, e não instala nada — sem Node, sem npm, sem build.
//!
//! O caminho antigo continua no arquivo, atrás de `IARA_MOTOR_LOCAL=1`, porque
//! quem DESENVOLVE a IARA precisa rodar o motor local e a janela junto. Isso é
//! ferramenta de desenvolvimento, não o produto.
//!
//! Nenhuma ação no computador do operador acontece aqui — criar pasta, abrir
//! aplicativo e energia continuam no `AgenteLocal` do motor, com allowlist,
//! raízes autorizadas e confirmação R2. Isso MUDA na Fase 3, quando o motor na
//! nuvem deixar de alcançar esta máquina sozinho e o braço passar a ser aqui;
//! até lá, o Rust só desenha janela.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Janela principal e bolha. A bolha vem declarada em `tauri.conf.json` porque
/// é asset local e não muda; a principal NÃO pode vir de lá — o destino dela é
/// decidido em runtime por três fontes (ver `destino`), e o JSON do Tauri é
/// estático.
const JANELA_PAINEL: &str = "principal";
const JANELA_BOLHA: &str = "bolha";

/// Último recurso, quando nenhuma das outras fontes responde.
const DESTINO_PADRAO: &str = "https://iara.atoslog.com.br";

/// Porta do motor local. Só é usada no modo de desenvolvimento.
const PORTA_MOTOR_LOCAL: u16 = 3000;

/// De quanto em quanto tempo a sonda tenta de novo enquanto a IARA está fora de
/// alcance. 15 s é o compromisso: rápido o bastante para a janela voltar
/// sozinha antes de a pessoa desistir, lento o bastante para não martelar um
/// host que está reiniciando.
const RITMO_SONDA: Duration = Duration::from_secs(15);

/// Fechar no X recolhe — encerrar de verdade é decisão explícita, pela bandeja.
static ENCERRANDO: AtomicBool = AtomicBool::new(false);

/// PID do motor que ESTE processo subiu (só no modo local). Fica vazio quando o
/// motor já estava de pé: nesse caso o shell não é dono dele e não o derruba.
static MOTOR_FILHO: Mutex<Option<u32>> = Mutex::new(None);

/// Uma sonda por vez. Sem isto, cliques repetidos em "Tentar agora" empilham
/// requisições e a janela pode navegar duas vezes.
static SONDANDO: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Destino
// ---------------------------------------------------------------------------

/// Onde a IARA mora, nesta ordem:
///
/// 1. `IARA_URL` — o loop de desenvolvimento (`http://localhost:3000`).
/// 2. `%APPDATA%\br.com.atoslog.iara\destino.json` — permite trocar de
///    homologação para produção numa máquina instalada, sem recompilar nada.
/// 3. `IARA_URL_PADRAO` assada em tempo de build — é assim que o instalador de
///    cada cliente sai apontando para o lugar certo.
/// 4. O literal acima.
fn destino() -> String {
    if let Ok(indicado) = std::env::var("IARA_URL") {
        let limpo = indicado.trim().trim_end_matches('/').to_string();
        if destino_aceitavel(&limpo) {
            return limpo;
        }
        eprintln!("[iara] IARA_URL recusada: {limpo}");
    }

    if let Some(arquivo) = destino_do_arquivo() {
        return arquivo;
    }

    if let Some(assado) = option_env!("IARA_URL_PADRAO") {
        let limpo = assado.trim().trim_end_matches('/').to_string();
        if destino_aceitavel(&limpo) {
            return limpo;
        }
    }

    DESTINO_PADRAO.to_string()
}

fn destino_do_arquivo() -> Option<String> {
    let base = std::env::var("APPDATA").ok()?;
    let caminho = PathBuf::from(base)
        .join("br.com.atoslog.iara")
        .join("destino.json");
    let bruto = fs::read_to_string(&caminho).ok()?;
    let json: serde_json::Value = serde_json::from_str(&bruto).ok()?;
    let url = json.get("url")?.as_str()?.trim().trim_end_matches('/');
    if destino_aceitavel(url) {
        return Some(url.to_string());
    }
    eprintln!("[iara] destino.json recusado ({caminho:?}): {url}");
    None
}

/// Só HTTPS, exceto localhost.
///
/// Uma janela do PRODUTO carregando `http://` de um host remoto é um
/// intermediário podendo reescrever a página inteira — e a página em questão é
/// aquela onde a operadora digita a senha. Recusar é barato; o caso legítimo de
/// HTTP é o motor rodando na própria máquina, onde não há rede no meio.
fn destino_aceitavel(url: &str) -> bool {
    if let Some(resto) = url.strip_prefix("https://") {
        let host = hospedeiro(resto);
        // Userinfo não tem uso legítimo aqui e tem uso ilegítimo óbvio:
        // `https://iara.atoslog.com.br@evil.com` conecta em evil.com e exibe o
        // nome de casa na barra de quem olhar rápido.
        return !host.is_empty() && !host.contains('@');
    }
    if let Some(resto) = url.strip_prefix("http://") {
        let host = hospedeiro(resto);
        // COMPARAÇÃO EXATA, nunca prefixo. `starts_with("localhost")` aceita
        // `localhost.evil.com` — um domínio de outra pessoa, servido em texto
        // puro, dentro da moldura da IARA. Foi assim que esta função nasceu
        // errada, e é o que o teste `nao_se_engana_com_prefixo_parecido` trava.
        return host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    }
    false
}

/// O hospedeiro, sem porta, sem caminho e sem query.
///
/// IPv6 vem entre colchetes (`[::1]:3000`), então o `:` que separa a porta é o
/// que vem DEPOIS do `]` — cortar no primeiro `:` transformaria `[::1]` em `[`.
fn hospedeiro(resto: &str) -> &str {
    let fim = resto.find(['/', '?', '#']).unwrap_or(resto.len());
    let autoridade = &resto[..fim];

    if let Some(fecha) = autoridade.find(']') {
        return &autoridade[..=fecha];
    }
    match autoridade.find(':') {
        Some(i) => &autoridade[..i],
        None => autoridade,
    }
}

#[cfg(test)]
mod testes {
    use super::{destino_aceitavel, tem_assinatura};

    #[test]
    fn assinatura_reconhece_o_saude_real() {
        // A resposta que `servidor/principal.ts` emite hoje, nos dois modos.
        let unificado = r#"{"app":"iara","ok":true,"uptime_s":3,"modo":"producao","projecao":"anexa","autenticacao":"supabase"}"#;
        let headless = r#"{"app":"iara","ok":true,"uptime_s":3,"modo":"producao","projecao":"externa","autenticacao":"supabase"}"#;
        assert!(tem_assinatura(unificado));
        assert!(tem_assinatura(headless));
        // Campo novo no /saude não pode quebrar a checagem: ela olha a chave,
        // não a forma do objeto.
        assert!(tem_assinatura(r#"{"app":"iara","dispositivos":2,"novo":null}"#));
        assert!(tem_assinatura(r#"{ "app": "iara" }"#));
    }

    #[test]
    fn assinatura_recusa_quem_nao_e_a_iara() {
        // O caso real: portal de Wi-Fi ou proxy corporativo devolvendo 200.
        assert!(!tem_assinatura("<h1>portal de wifi</h1>"));
        assert!(!tem_assinatura("<html><body>Faça login para acessar a rede</body></html>"));
        assert!(!tem_assinatura(""));
        // Outro servidor de desenvolvimento na mesma porta.
        assert!(!tem_assinatura(r#"{"app":"outro-produto","ok":true}"#));
        // E o quase-acerto: nome parecido não é a assinatura.
        assert!(!tem_assinatura(r#"{"app":"iara-clone"}"#));
        assert!(!tem_assinatura(r#"{"aplicativo":"iara"}"#));
    }

    #[test]
    fn https_passa() {
        assert!(destino_aceitavel("https://iara.atoslog.com.br"));
        assert!(destino_aceitavel("https://iara-homologacao.up.railway.app"));
    }

    #[test]
    fn http_remoto_e_recusado() {
        // O caso que esta função existe para barrar: a janela do PRODUTO
        // carregando a tela de senha por um canal que qualquer intermediário
        // reescreve.
        assert!(!destino_aceitavel("http://iara.atoslog.com.br"));
        assert!(!destino_aceitavel("http://192.168.0.10:3000"));
    }

    #[test]
    fn http_local_passa() {
        // O caso legítimo de HTTP: o motor na própria máquina, sem rede no meio.
        assert!(destino_aceitavel("http://localhost:3000"));
        assert!(destino_aceitavel("http://127.0.0.1:3000"));
        assert!(destino_aceitavel("http://[::1]:3000"));
    }

    #[test]
    fn nao_se_engana_com_prefixo_parecido() {
        // `localhost.evil.com` COMEÇA com "localhost" — e é um domínio de outra
        // pessoa, servido em texto puro. Este teste pegou a função errada na
        // primeira escrita; é ele que separa a checagem correta de uma que só
        // parece correta.
        assert!(!destino_aceitavel("http://localhost.evil.com"));
        assert!(!destino_aceitavel("http://127.0.0.1.evil.com"));
        assert!(!destino_aceitavel("http://localhost@evil.com"));
        assert!(!destino_aceitavel("https://iara.atoslog.com.br@evil.com"));
    }

    #[test]
    fn caminho_e_porta_nao_confundem_o_hospedeiro() {
        assert!(destino_aceitavel("http://localhost:3000/painel"));
        assert!(destino_aceitavel("https://iara.atoslog.com.br/entrar?x=1"));
        // O host continua sendo localhost; o resto é caminho.
        assert!(destino_aceitavel("http://localhost/#/evil.com"));
        // Mas isto é um domínio de terceiro com "localhost" no caminho.
        assert!(!destino_aceitavel("http://evil.com/localhost"));
    }

    #[test]
    fn esquema_ausente_ou_estranho_e_recusado() {
        assert!(!destino_aceitavel("iara.atoslog.com.br"));
        assert!(!destino_aceitavel("file:///C:/Windows/System32"));
        assert!(!destino_aceitavel("javascript:alert(1)"));
        assert!(!destino_aceitavel(""));
        assert!(!destino_aceitavel("https://"));
    }
}

// ---------------------------------------------------------------------------
// Sonda de saúde
// ---------------------------------------------------------------------------

/// Quem atende no destino.
///
/// A pergunta "o endereço responde?" é insuficiente de um jeito perigoso, e
/// continua sendo depois da virada para a nuvem — só mudou o vilão. Antes era a
/// porta 3000 tomada por outro servidor de desenvolvimento; agora é um portal
/// de Wi-Fi público ou um proxy corporativo devolvendo uma página de login com
/// status 200. Nos dois casos a janela carregaria o app de um estranho dentro
/// da moldura da IARA, sem um aviso sequer.
///
/// Por isso a prova continua sendo a ASSINATURA do `/saude`, não o status HTTP.
enum Alcance {
    /// O motor da IARA. Pode navegar.
    Motor,
    /// Ninguém respondeu: rede caída, host fora do ar, DNS falhando.
    Mudo,
    /// Alguém respondeu, e não é a IARA.
    Estranho,
}

fn sondar(base: &str) -> Alcance {
    let alvo = format!("{}/saude", base.trim_end_matches('/'));
    let resposta = ureq::get(&alvo)
        .timeout(Duration::from_secs(3))
        .set("Accept", "application/json")
        .call();

    let corpo = match resposta {
        Ok(r) => r,
        // Status de erro É resposta: alguém está lá, só não é a IARA.
        Err(ureq::Error::Status(_, _)) => return Alcance::Estranho,
        Err(_) => return Alcance::Mudo,
    };

    // Teto de leitura: o /saude cabe de sobra em 4 KB, e sem o teto um host
    // estranho respondendo algo enorme travaria o arranque.
    let mut texto = String::new();
    if corpo
        .into_reader()
        .take(4096)
        .read_to_string(&mut texto)
        .is_err()
    {
        return Alcance::Estranho;
    }

    if tem_assinatura(&texto) {
        Alcance::Motor
    } else {
        Alcance::Estranho
    }
}

/// A prova de que quem respondeu é a IARA.
///
/// A assinatura mora em `servidor/principal.ts` — mudar a string de lá quebra
/// esta checagem. Aceita com e sem espaço depois dos dois-pontos porque o
/// FORMATO do JSON não é contrato; a chave e o valor são.
///
/// Isto é uma função à parte, e não uma linha dentro de `sondar`, porque é a
/// única decisão do arranque que pode errar de um jeito que ninguém percebe: um
/// portal de Wi-Fi ou um proxy corporativo devolve 200 com HTML, e sem esta
/// checagem a janela carregaria a página deles dentro da moldura da IARA.
fn tem_assinatura(texto: &str) -> bool {
    texto.contains("\"app\":\"iara\"") || texto.contains("\"app\": \"iara\"")
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------

/// Visível e em foco → recolhe. Caso contrário → mostra e traz para a frente.
///
/// `is_visible` sozinho não basta: com a janela aberta atrás de outro app, o
/// Alt+Space precisa trazê-la para a frente, não escondê-la.
fn alternar(app: &AppHandle) {
    let Some(painel) = app.get_webview_window(JANELA_PAINEL) else {
        return;
    };
    let visivel = painel.is_visible().unwrap_or(false);
    let focado = painel.is_focused().unwrap_or(false);

    if visivel && focado {
        let _ = painel.hide();
    } else {
        let _ = painel.show();
        let _ = painel.unminimize();
        let _ = painel.set_focus();
    }
}

fn revelar(app: &AppHandle) {
    if let Some(painel) = app.get_webview_window(JANELA_PAINEL) {
        let _ = painel.show();
        let _ = painel.unminimize();
        let _ = painel.set_focus();
    }
}

/// Cria a janela principal apontada para `url`.
///
/// Em Rust e não no `tauri.conf.json` porque o destino é decidido em runtime.
/// O JSON continua descrevendo a bolha, que não tem essa necessidade.
fn abrir_painel(app: &AppHandle, url: WebviewUrl) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, JANELA_PAINEL, url)
        .title("IARA")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .visible(true)
        .build()?;
    Ok(())
}

/// O HTML da página offline não conhece nenhuma das três fontes de destino —
/// quem sabe é o Rust. Isto entrega o endereço tentado para a tela.
fn anunciar_destino(app: &AppHandle, alvo: &str, motivo: &str) {
    let Some(painel) = app.get_webview_window(JANELA_PAINEL) else {
        return;
    };
    let alvo = alvo.replace('\\', "\\\\").replace('\'', "\\'");
    let motivo = motivo.replace('\\', "\\\\").replace('\'', "\\'");
    let _ = painel.eval(&format!(
        "window.definirDestino && window.definirDestino('{alvo}'); \
         window.definirAviso && window.definirAviso('{motivo}');"
    ));
}

// ---------------------------------------------------------------------------
// Comandos chamados pelas janelas locais (bolha e offline)
// ---------------------------------------------------------------------------

/// Arrasto nativo. O HTML decide *quando* é arrasto (mouse andou mais que o
/// limiar); aqui só entregamos o gesto ao gerenciador de janelas — arrastar no
/// JS, recolocando a janela a cada mousemove, tremeria.
#[tauri::command]
fn arrastar_bolha(app: AppHandle) {
    if let Some(bolha) = app.get_webview_window(JANELA_BOLHA) {
        let _ = bolha.start_dragging();
    }
}

/// Clique na bolha e Alt+Space caem os dois aqui: um gesto, um comportamento.
#[tauri::command]
fn alternar_painel(app: AppHandle) {
    alternar(&app);
}

/// A página offline avisa que terminou de carregar. Sem este aperto de mão, o
/// `eval` do destino poderia disparar antes do parse do script e se perder.
#[tauri::command]
fn offline_pronta(app: AppHandle) {
    anunciar_destino(&app, &destino(), "");
}

/// "Tentar agora". Devolve `true` se navegou; a página só continua existindo
/// quando devolve `false`.
#[tauri::command]
fn tentar_destino(app: AppHandle) -> bool {
    if SONDANDO.swap(true, Ordering::SeqCst) {
        return false;
    }
    let alvo = destino();
    let resultado = sondar(&alvo);
    SONDANDO.store(false, Ordering::SeqCst);

    match resultado {
        Alcance::Motor => {
            if let Some(painel) = app.get_webview_window(JANELA_PAINEL) {
                if let Ok(url) = alvo.parse() {
                    let _ = painel.navigate(url);
                    return true;
                }
            }
            false
        }
        Alcance::Estranho => {
            anunciar_destino(
                &app,
                &alvo,
                "Esse endereço respondeu, mas não é a IARA. Pode ser um portal de Wi-Fi ou um proxy.",
            );
            false
        }
        Alcance::Mudo => false,
    }
}

// ---------------------------------------------------------------------------
// Vigia: traz a janela de volta sozinha quando a IARA reaparece
// ---------------------------------------------------------------------------

fn vigiar(app: AppHandle, alvo: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(RITMO_SONDA);
        if ENCERRANDO.load(Ordering::SeqCst) {
            return;
        }
        if SONDANDO.swap(true, Ordering::SeqCst) {
            continue;
        }
        let resultado = sondar(&alvo);
        SONDANDO.store(false, Ordering::SeqCst);

        if let Alcance::Motor = resultado {
            if let Some(painel) = app.get_webview_window(JANELA_PAINEL) {
                if let Ok(url) = alvo.parse() {
                    let _ = painel.navigate(url);
                }
            }
            return; // alcançou: o vigia cumpriu o papel e sai.
        }
    });
}

// ---------------------------------------------------------------------------
// Motor local — SÓ desenvolvimento, atrás de IARA_MOTOR_LOCAL=1
// ---------------------------------------------------------------------------

/// Este bloco inteiro é ferramenta de quem desenvolve a IARA, não o produto.
///
/// Ele NÃO é código morto e não deve ser apagado: sem ele, trabalhar no motor e
/// na janela ao mesmo tempo obriga a abrir o navegador ao lado do app, e a
/// diferença entre os dois ambientes é justamente onde os defeitos do shell se
/// escondem.
mod local {
    use super::*;

    fn e_pasta_do_motor(caminho: &Path) -> bool {
        caminho.join("package.json").is_file() && caminho.join("servidor").is_dir()
    }

    /// Variável de ambiente, pasta `motor` ao lado do executável, e por fim o
    /// repositório subindo a árvore (cobre `target\debug` e `target\release`).
    fn achar_motor() -> Option<PathBuf> {
        if let Ok(indicado) = std::env::var("IARA_MOTOR_DIR") {
            let caminho = PathBuf::from(indicado);
            if e_pasta_do_motor(&caminho) {
                return Some(caminho);
            }
            eprintln!("[iara] IARA_MOTOR_DIR não aponta para o motor: {caminho:?}");
        }

        let executavel = std::env::current_exe().ok()?;
        let pasta_exe = executavel.parent()?;

        for ancestral in pasta_exe.ancestors() {
            for tentativa in [
                ancestral.join("motor"),
                ancestral.join("web"),
                ancestral.join("apps").join("web"),
                ancestral.join("iara-os").join("apps").join("web"),
            ] {
                if e_pasta_do_motor(&tentativa) {
                    return Some(tentativa);
                }
            }
        }

        None
    }

    /// Sobe o motor sem janela de terminal.
    fn subir_motor(pasta: &Path) -> std::io::Result<u32> {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let mut comando = Command::new("cmd");
        comando.args(["/C", "npm", "run", "start"]).current_dir(pasta);

        // Sem Supabase no ambiente, o motor recusaria subir por falta de
        // identidade. Aqui é o processo localhost do próprio desenvolvedor.
        comando.env("IARA_PERMITIR_MODO_LOCAL", "1");

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            comando.creation_flags(CREATE_NO_WINDOW);
        }

        comando.spawn().map(|filho| filho.id())
    }

    /// Espera o motor atender, com teto. A espera aceita SÓ o motor
    /// identificado, não "a porta abriu": durante o arranque o Next abre o
    /// socket antes de servir, e um TCP aberto daria verde cedo demais.
    fn esperar_motor(base: &str, limite: Duration) -> bool {
        let inicio = Instant::now();
        while inicio.elapsed() < limite {
            if matches!(sondar(base), Alcance::Motor) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(400));
        }
        false
    }

    /// Só sobe o motor se ninguém estiver atendendo. Com `npm run dev` já
    /// rodando em `apps/web`, o shell reusa e não assume a posse do processo.
    pub fn garantir_motor(app: &AppHandle) {
        let base = format!("http://localhost:{PORTA_MOTOR_LOCAL}");

        match sondar(&base) {
            Alcance::Motor => return,
            Alcance::Estranho => {
                eprintln!(
                    "[iara] a porta {PORTA_MOTOR_LOCAL} está ocupada por outro processo (não \
                     respondeu /saude como IARA). O motor não subiu."
                );
                return;
            }
            Alcance::Mudo => {}
        }

        let Some(pasta) = achar_motor() else {
            eprintln!(
                "[iara] motor não encontrado. Defina IARA_MOTOR_DIR ou rode `npm run dev` em apps/web."
            );
            return;
        };

        match subir_motor(&pasta) {
            Ok(pid) => {
                if let Ok(mut trava) = MOTOR_FILHO.lock() {
                    *trava = Some(pid);
                }
                let app = app.clone();
                // Fora da thread da UI: esperar aqui congelaria a janela.
                std::thread::spawn(move || {
                    if esperar_motor(&base, Duration::from_secs(90)) {
                        if let Some(painel) = app.get_webview_window(JANELA_PAINEL) {
                            if let Ok(url) = base.parse() {
                                let _ = painel.navigate(url);
                            }
                        }
                    } else {
                        eprintln!(
                            "[iara] o motor não respondeu em 90 s. Rodou `npm run build` em apps/web?"
                        );
                    }
                });
            }
            Err(erro) => eprintln!("[iara] falha ao subir o motor: {erro}"),
        }
    }

    /// `npm` no Windows é uma árvore: cmd → npm.cmd → node. Matar só o PID do
    /// topo deixaria o motor órfão segurando a porta até o reboot. `/T` derruba
    /// a árvore inteira.
    pub fn derrubar_motor() {
        let Some(pid) = MOTOR_FILHO.lock().ok().and_then(|mut t| t.take()) else {
            return;
        };
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
}

fn modo_motor_local() -> bool {
    std::env::var("IARA_MOTOR_LOCAL").is_ok_and(|v| v == "1")
}

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

fn montar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir a IARA", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Encerrar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &sair])?;

    let mut bandeja = TrayIconBuilder::with_id("bandeja")
        .tooltip("IARA")
        // Clique esquerdo alterna o painel; o menu fica no direito, como manda
        // a convenção do Windows.
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "abrir" => revelar(app),
            "sair" => {
                ENCERRANDO.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|bandeja, evento| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evento
            {
                alternar(bandeja.app_handle());
            }
        });

    // Sem ícone gerado (`npx tauri icon`), a bandeja ainda sobe — sem desenho,
    // mas com menu. Melhor que abortar o app inteiro por um .ico faltando.
    if let Some(icone) = app.default_window_icon() {
        bandeja = bandeja.icon(icone.clone());
    }

    bandeja.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------

fn main() {
    let atalho = Shortcut::new(Some(Modifiers::ALT), Code::Space);

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, disparado, evento| {
                    // Só na descida: sem isso o atalho alternaria duas vezes
                    // por toque, voltando ao estado anterior.
                    if disparado == &atalho && evento.state() == ShortcutState::Pressed {
                        alternar(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            arrastar_bolha,
            alternar_painel,
            offline_pronta,
            tentar_destino
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let alvo = destino();

            /* A JANELA NASCE NO LUGAR CERTO, e essa é a diferença que o
               operador percebe. Antes ela nascia apontada para o motor e
               carregava um erro de conexão enquanto ele subia; agora sondamos
               primeiro e só então decidimos o que mostrar. Trocar a ordem
               custa 3 s no pior caso e economiza a tela de erro do WebView2
               piscando dentro da moldura da IARA. */
            let alcance = sondar(&alvo);
            // `destino_aceitavel` já garantiu o esquema, então a falha de parse
            // aqui é praticamente impossível — mas "praticamente impossível"
            // envelhece mal, e o custo de tratá-la é uma linha.
            let url_valida = alvo.parse().ok();

            match (&alcance, url_valida) {
                (Alcance::Motor, Some(url)) => {
                    abrir_painel(&handle, WebviewUrl::External(url))?;
                }
                _ => {
                    // A janela JÁ nasce na página offline — nada de abrir no
                    // destino e navegar para o erro depois, que é o piscar de
                    // tela que esta ordem existe para evitar.
                    abrir_painel(&handle, WebviewUrl::App("offline.html".into()))?;
                    let motivo = match alcance {
                        Alcance::Estranho => {
                            "Esse endereço respondeu, mas não é a IARA. Pode ser um portal de Wi-Fi ou um proxy."
                        }
                        Alcance::Motor => "O endereço configurado não é uma URL válida.",
                        Alcance::Mudo => "",
                    };
                    if !motivo.is_empty() {
                        anunciar_destino(&handle, &alvo, motivo);
                    }
                    vigiar(handle.clone(), alvo.clone());
                }
            }

            if modo_motor_local() {
                local::garantir_motor(&handle);
            }

            montar_bandeja(&handle)?;

            // Um atalho global tomado por outro app não é motivo para o shell
            // não abrir: a bolha e a bandeja continuam servindo.
            if let Err(erro) = app.global_shortcut().register(atalho) {
                eprintln!("[iara] Alt+Space indisponível (outro app o tomou?): {erro}");
            }
            Ok(())
        })
        .on_window_event(|janela, evento| {
            if let WindowEvent::CloseRequested { api, .. } = evento {
                // O X recolhe. A IARA continua presente na bolha e na bandeja —
                // fechar a janela não é encerrar o expediente.
                if janela.label() == JANELA_PAINEL && !ENCERRANDO.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = janela.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao montar o shell da IARA");

    app.run(|_app, evento| {
        if let RunEvent::Exit = evento {
            ENCERRANDO.store(true, Ordering::SeqCst);
            if modo_motor_local() {
                local::derrubar_motor();
            }
        }
    });
}
