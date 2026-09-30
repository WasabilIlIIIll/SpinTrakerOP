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
