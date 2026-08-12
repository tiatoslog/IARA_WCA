// Sem console preto atrás do app em release. Em debug o console fica: é onde
// os avisos de "motor não subiu" aparecem durante o desenvolvimento.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Shell desktop da IARA — Tauri 2.
//!
//! O Rust aqui cuida SÓ de janela e de ciclo de vida do motor. Nenhuma ação no
//! computador do operador acontece neste processo: criar pasta, abrir
//! aplicativo e energia moram no `AgenteLocal` do motor Node, com allowlist,
//! raízes autorizadas e confirmação R2. O webview conversa com ele em
//! localhost:3000 — mesma origem e mesmo contrato do navegador.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// A porta do motor é a mesma do navegador. Uma origem só, um contrato só.
const PORTA_MOTOR: u16 = 3000;

/// Janela principal e bolha vêm declaradas em `tauri.conf.json`; o Rust só as
/// referencia por rótulo. Trocar tamanho ou posição é edição de config, não de
/// código.
const JANELA_PAINEL: &str = "principal";
const JANELA_BOLHA: &str = "bolha";

/// Fechar no X recolhe a janela — encerrar de verdade é decisão explícita, pela
/// bandeja. Esta trava distingue os dois casos para o `CloseRequested`.
static ENCERRANDO: AtomicBool = AtomicBool::new(false);

/// PID do motor que ESTE processo subiu. Fica vazio quando o motor já estava de
/// pé (`npm run dev` do operador): nesse caso o shell não é dono dele e não o
/// derruba ao sair.
static MOTOR_FILHO: Mutex<Option<u32>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Comandos chamados pela bolha (ui/bolha.html)
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

// ---------------------------------------------------------------------------
// Motor: descoberta, subida e encerramento
// ---------------------------------------------------------------------------

/// Quem atende na porta do motor.
///
/// A pergunta ANTIGA era "a porta responde?", e ela é insuficiente de um jeito
/// perigoso: 3000 é a porta mais disputada que existe em máquina de
/// desenvolvimento. Qualquer outro servidor ali fazia o shell desistir de subir
/// o motor E a janela carregar o app do estranho — dentro da moldura da IARA,
/// sem um aviso sequer. Falha silenciosa que se parece com um bug do produto.
enum NaPorta {
    /// Ninguém atende. O shell sobe o motor.
    Muda,
    /// O motor da IARA, já de pé (o `npm run dev` do operador, ou outra
    /// instância do app). Reusar, e não assumir posse do processo.
    Motor,
    /// Alguém atende, mas não é o motor. Subir por cima é impossível — a porta
    /// está tomada — e mostrar o que está lá seria mentir sobre o que a janela
    /// é. O caso certo é parar e dizer.
    Estranho,
}

/// Uma requisição HTTP escrita à mão, para não trazer um cliente HTTP inteiro
/// como dependência por causa de uma linha. `Connection: close` faz o servidor
/// encerrar sozinho e a leitura terminar sem precisar entender o corpo.
fn quem_esta_na_porta() -> NaPorta {
    let endereco = SocketAddr::from(([127, 0, 0, 1], PORTA_MOTOR));
    let Ok(mut conexao) = TcpStream::connect_timeout(&endereco, Duration::from_millis(300)) else {
        return NaPorta::Muda;
    };

    let _ = conexao.set_read_timeout(Some(Duration::from_millis(1200)));
    let _ = conexao.set_write_timeout(Some(Duration::from_millis(600)));

    let pedido = format!(
        "GET /saude HTTP/1.1
Host: 127.0.0.1:{PORTA_MOTOR}
Connection: close

"
    );
    if conexao.write_all(pedido.as_bytes()).is_err() {
        return NaPorta::Estranho;
    }

    // O /saude cabe de sobra em 4 KB. Ler mais do que isso só abriria espaço
    // para um servidor estranho responder algo enorme e travar o arranque.
    let mut resposta = Vec::new();
    let mut pedaco = [0u8; 1024];
    while resposta.len() < 4096 {
        match conexao.read(&mut pedaco) {
            Ok(0) => break,
            Ok(n) => resposta.extend_from_slice(&pedaco[..n]),
            Err(_) => break,
        }
    }

    let texto = String::from_utf8_lossy(&resposta);
    // A assinatura mora em `servidor/principal.ts`. Aceita com e sem espaço
    // porque o formato do JSON não é contrato — a chave e o valor são.
    if texto.contains("\"app\":\"iara\"") || texto.contains("\"app\": \"iara\"") {
        NaPorta::Motor
    } else {
        NaPorta::Estranho
    }
}

/// Uma pasta só serve como motor se tiver o `package.json` do app web.
fn e_pasta_do_motor(caminho: &Path) -> bool {
    caminho.join("package.json").is_file() && caminho.join("servidor").is_dir()
}

/// Ordem de busca declarada no README: variável de ambiente, pasta `motor` ao
/// lado do executável, e por fim o repositório subindo a árvore (o que cobre
/// `target\debug` e `target\release` no desenvolvimento).
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

    // Instalado: o motor viaja junto, ao lado do .exe.
    let vizinho = pasta_exe.join("motor");
    if e_pasta_do_motor(&vizinho) {
        return Some(vizinho);
    }

    // Desenvolvimento: subir até reencontrar o repositório.
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

/// A porta está tomada por outro processo. Isto não tem conserto automático:
/// o motor não pode subir e o que está lá não é a IARA.
///
/// A mensagem vai para o log E para a janela. O log sozinho não basta porque em
/// release não há console — o operador veria uma janela com o app de outra
/// pessoa e nenhuma explicação. O `eval` roda no contexto da página do
/// estranho, então pode ser barrado pela CSP dele; por isso é a segunda linha
/// de defesa, e não a única.
fn avisar_porta_tomada(app: &AppHandle) {
    eprintln!(
        "[iara] a porta {PORTA_MOTOR} está ocupada por outro processo (não respondeu          /saude como IARA). O motor não subiu. Libere a porta ou encerre o outro          servidor e abra a IARA de novo."
    );

    if let Some(painel) = app.get_webview_window(JANELA_PAINEL) {
        let aviso = format!(
            "document.documentElement.innerHTML =              '<body style=\"margin:0;display:flex;align-items:center;justify-content:center;             height:100vh;background:#0b0d0f;color:#eef1f4;font:14px system-ui;text-align:center\">             <div style=\"max-width:34rem;padding:2rem;line-height:1.6\">             <p style=\"letter-spacing:.22em;font-weight:600\">I A R A</p>             <p>A porta {PORTA_MOTOR} está ocupada por outro programa.</p>             <p style=\"color:#8b959d\">O motor da IARA não pôde subir. Encerre o outro              servidor que está usando essa porta e abra a IARA de novo.</p></div></body>'"
        );
        let _ = painel.eval(&aviso);
    }
}

/// Sobe o motor em modo produção, sem janela de terminal.
///
/// `CREATE_NO_WINDOW` é o ponto todo do V4: a experiência final é abrir
/// IARA.exe, nunca "primeiro rode npm num cmd preto".
fn subir_motor(pasta: &Path) -> std::io::Result<u32> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut comando = Command::new("cmd");
    comando.args(["/C", "npm", "run", "start"]).current_dir(pasta);

    // Sem Supabase no ambiente, o motor recusaria subir por falta de
    // identidade. Aqui é o processo localhost do próprio operador — decisão
    // consciente, registrada no README. Com Supabase no .env.local a
    // autenticação real assume e esta variável passa a ser irrelevante.
    comando.env("IARA_PERMITIR_MODO_LOCAL", "1");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        comando.creation_flags(CREATE_NO_WINDOW);
    }

    comando.spawn().map(|filho| filho.id())
}

/// Espera o motor atender, com teto. Se estourar, o webview mostra o erro do
/// próprio Windows — melhor que uma janela em branco sem explicação.
///
/// A espera aceita SÓ o motor identificado, não "a porta abriu". Durante o
/// arranque o Next abre o socket antes de servir, e um TCP aberto aqui daria
/// verde cedo demais: a janela recarregaria contra um servidor que ainda não
/// responde e o operador veria o erro de conexão que este método existe para
/// evitar. Só o /saude com a assinatura prova que dá para recarregar.
fn esperar_motor(limite: Duration) -> bool {
    let inicio = Instant::now();
    while inicio.elapsed() < limite {
        if matches!(quem_esta_na_porta(), NaPorta::Motor) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    false
}

/// `npm` no Windows é uma árvore: cmd → npm.cmd → node. Matar só o PID do topo
/// deixaria o motor rodando órfão, segurando a porta 3000 até o reboot. `/T`
/// derruba a árvore inteira.
fn derrubar_motor() {
    let Some(pid) = MOTOR_FILHO.lock().ok().and_then(|mut t| t.take()) else {
        return;
    };
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
}

/// Só sobe o motor se a porta estiver muda. Com `npm run dev` já rodando em
/// `apps/web`, o shell detecta a porta ocupada e não duplica nada — e não
/// assume a posse de um processo que não é dele.
fn garantir_motor(app: &AppHandle) {
    match quem_esta_na_porta() {
        NaPorta::Motor => return,
        NaPorta::Estranho => {
            avisar_porta_tomada(app);
            return;
        }
        NaPorta::Muda => {}
    }

    let Some(pasta) = achar_motor() else {
        eprintln!("[iara] motor não encontrado. Defina IARA_MOTOR_DIR ou rode `npm run dev` em apps/web.");
        return;
    };

    match subir_motor(&pasta) {
        Ok(pid) => {
            if let Ok(mut trava) = MOTOR_FILHO.lock() {
                *trava = Some(pid);
            }
            let app = app.clone();
            // Fora da thread da UI: esperar aqui congelaria a janela e a bolha.
            std::thread::spawn(move || {
                if esperar_motor(Duration::from_secs(90)) {
                    // As janelas nasceram antes do motor atender e carregaram
                    // um erro de conexão. Recarregar agora é o que faz a tela
                    // certa aparecer sem o operador apertar nada.
                    if let Some(painel) = app.get_webview_window(JANELA_PAINEL) {
                        let _ = painel.eval("window.location.reload()");
                    }
                } else {
                    eprintln!("[iara] o motor não respondeu em 90 s. Rodou `npm run build` em apps/web?");
                }
            });
        }
        Err(erro) => eprintln!("[iara] falha ao subir o motor: {erro}"),
    }
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
        .menu(&menu)
        // Clique esquerdo alterna o painel; o menu fica no direito, como manda
        // a convenção do Windows.
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
        .invoke_handler(tauri::generate_handler![arrastar_bolha, alternar_painel])
        .setup(move |app| {
            let handle = app.handle().clone();
            garantir_motor(&handle);
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
            derrubar_motor();
        }
    });
}
