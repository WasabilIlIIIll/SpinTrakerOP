//! Coque « posée sur le bureau » : l'application affiche le fond d'écran Windows exactement à sa
//! place, pour que ses panneaux de verre semblent flotter directement sur le bureau.

use base64::Engine;
use std::path::PathBuf;

/// Chemin du fond d'écran actuel : celui déclaré à Windows, sinon la copie que Windows en garde
/// (`TranscodedWallpaper`, toujours présente sous Windows 10 et 11 pour un fond image).
fn wallpaper_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETDESKWALLPAPER};
        let mut buf = [0u16; 1024];
        let ok = unsafe { SystemParametersInfoW(SPI_GETDESKWALLPAPER, buf.len() as u32, buf.as_mut_ptr() as *mut _, 0) };
        if ok != 0 {
            let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
            let p = PathBuf::from(String::from_utf16_lossy(&buf[..n]));
            if n > 0 && p.is_file() {
                return Some(p);
            }
        }
        let t = PathBuf::from(std::env::var("APPDATA").ok()?).join("Microsoft/Windows/Themes/TranscodedWallpaper");
        if t.is_file() {
            return Some(t);
        }
    }
    None
}

/// Fond d'écran en data URL (null pour un fond uni ou introuvable : l'interface garde alors son
/// propre décor).
#[tauri::command]
pub fn desktop_wallpaper() -> Option<String> {
    let p = wallpaper_path()?;
    let bytes = std::fs::read(&p).ok()?;
    let mime = match bytes.get(..4) {
        Some([0x89, b'P', b'N', b'G']) => "image/png",
        Some([b'R', b'I', b'F', b'F']) => "image/webp",
        Some([b'B', b'M', ..]) => "image/bmp",
        _ => "image/jpeg",
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

// ---------------------------------------------------------------- fenêtre transparente

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
struct Bounds {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

fn bounds_file(win: &WebviewWindow) -> Option<PathBuf> {
    let st = win.try_state::<crate::AppState>()?;
    Some(st.db_path.parent()?.join("fenetre.json"))
}

fn work_area(win: &WebviewWindow) -> Option<Bounds> {
    let m = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten())?;
    let a = m.work_area();
    Some(Bounds { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height })
}

fn apply(win: &WebviewWindow, b: Bounds) {
    let _ = win.set_position(PhysicalPosition::new(b.x, b.y));
    let _ = win.set_size(PhysicalSize::new(b.w, b.h));
}

/// Au démarrage : la dernière position si elle est encore sur un écran, sinon toute la zone de
/// travail (l'écran sans la barre des tâches).
pub fn place_window(win: &WebviewWindow) {
    let saved: Option<Bounds> = bounds_file(win).and_then(|f| std::fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok());
    let monitors = win.available_monitors().unwrap_or_default();
    let visible = |b: &Bounds| {
        monitors.iter().any(|m| {
            let a = m.work_area();
            b.x + 80 < a.position.x + a.size.width as i32 && b.x + b.w as i32 - 80 > a.position.x && b.y >= a.position.y - 20 && b.y + 60 < a.position.y + a.size.height as i32
        })
    };
    match saved.filter(|b| b.w >= 800 && b.h >= 500 && visible(b)) {
        Some(b) => apply(win, b),
        None => {
            if let Some(a) = work_area(win) {
                apply(win, a);
            }
        }
    }
}

/// Mémorise la position et la taille (appelé à la fermeture).
pub fn save_window(win: &WebviewWindow) {
    let (Ok(p), Ok(s)) = (win.outer_position(), win.outer_size()) else { return };
    if let Some(f) = bounds_file(win) {
        let _ = std::fs::write(f, serde_json::to_string(&Bounds { x: p.x, y: p.y, w: s.width, h: s.height }).unwrap_or_default());
    }
}

/// Bouton □ : remplit la zone de travail, ou revient à une fenêtre plus petite et centrée.
#[tauri::command]
pub fn window_toggle_fill(win: WebviewWindow) {
    let Some(a) = work_area(&win) else { return };
    let full = win.outer_size().map(|s| s.width + 8 >= a.w && s.height + 8 >= a.h).unwrap_or(false);
    if full {
        let (w, h) = (a.w * 4 / 5, a.h * 4 / 5);
        apply(&win, Bounds { x: a.x + (a.w - w) as i32 / 2, y: a.y + (a.h - h) as i32 / 2, w, h });
    } else {
        apply(&win, a);
    }
}
