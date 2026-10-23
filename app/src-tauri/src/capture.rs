//! Modo Holyrics: foto (PNG) da janela de projeção, que desenha o slide igual à prévia do AVDP.
//! O Holyrics recebe essa imagem pela aba Imagens (`ShowImage`), então o telão dele fica idêntico.

use crate::error::AppError;
use tauri::WebviewWindow;

#[cfg(windows)]
pub async fn png(win: &WebviewWindow) -> Result<Vec<u8>, AppError> {
    use std::sync::{Arc, Mutex};
    use webview2_com::{CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG};
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;

    unsafe fn read(s: &IStream) -> windows::core::Result<Vec<u8>> {
        let mut stat = Default::default();
        unsafe { s.Stat(&mut stat, STATFLAG_NONAME)? };
        unsafe { s.Seek(0, STREAM_SEEK_SET, None)? };
        let mut buf = vec![0u8; stat.cbSize as usize];
        let mut got = 0u32;
        unsafe { s.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut got)).ok()? };
        buf.truncate(got as usize);
        Ok(buf)
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = move |r: Result<Vec<u8>, String>| {
        if let Some(t) = tx.lock().ok().and_then(|mut g| g.take()) {
            let _ = t.send(r);
        }
    };
    win.with_webview(move |pv| {
        let send2 = send.clone();
        let started = (|| -> windows::core::Result<()> {
            let core = unsafe { pv.controller().CoreWebView2()? };
            let stream = unsafe { SHCreateMemStream(None) }.ok_or_else(|| windows::core::Error::new(windows::core::HRESULT(0x8007000Eu32 as i32), "SHCreateMemStream"))?;
            let s2 = stream.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |hr: windows::core::Result<()>| {
                send2(hr.and_then(|_| unsafe { read(&s2) }).map_err(|e| e.to_string()));
                Ok(())
            }));
            unsafe { core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, &stream, &handler) }
        })();
        if let Err(e) = started {
            send(Err(e.to_string()));
        }
    })?;
    rx.await.map_err(|_| AppError::msg("a foto da projeção não voltou"))?.map_err(|e| AppError::msg(format!("foto da projeção: {e}")))
}

#[cfg(not(windows))]
pub async fn png(_win: &WebviewWindow) -> Result<Vec<u8>, AppError> {
    Err(AppError::msg("modo Holyrics só no Windows"))
}
