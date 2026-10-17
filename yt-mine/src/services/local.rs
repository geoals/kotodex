
use std::future::Future;
use std::pin::Pin;

use crate::services::download::{AudioDownload, DownloadError, MediaDownloader};

pub struct LocalFile;

impl MediaDownloader for LocalFile {
    fn download_audio(
        &self,
        path: String,
        output_dir: String,
    ) -> Pin<Box<dyn Future<Output = Result<AudioDownload, DownloadError>> + Send>> {
        Box::pin(async move {
            tokio::fs::create_dir_all(&output_dir)
                .await
                .map_err(|e| DownloadError::Failed(format!("cannot create {output_dir}: {e}")))?;
            let audio_path = format!("{output_dir}/{}.wav", local_video_id(&path));

            let out = tokio::process::Command::new("ffmpeg")
                .args(["-i", &path, "-map", "0:a:0", "-acodec", "pcm_s16le"])
                .args(["-ar", "16000", "-ac", "1", &audio_path, "-y"])
                .output()
                .await
                .map_err(|e| DownloadError::Failed(format!("failed to run ffmpeg: {e}")))?;
            if !out.status.success() {
                return Err(DownloadError::Failed(format!(
                    "ffmpeg audio extraction failed: {}",
                    String::from_utf8_lossy(&out.stderr)
                )));
            }

            Ok(AudioDownload {
                audio_path,
                video_duration: duration(&path).await,
                video_title: title(&path),
                source_audio_path: path,
            })
        })
    }

    fn download_video(
        &self,
        path: String,
        _output_dir: String,
    ) -> Pin<Box<dyn Future<Output = Result<String, DownloadError>> + Send>> {
        Box::pin(async move { Ok(path) })
    }
}

pub fn title(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

async fn duration(path: &str) -> Option<f64> {
    let out = tokio::process::Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
        .output()
        .await
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

pub fn local_video_id(path: &str) -> String {
    let hash = path.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    });
    format!("local-{hash:016x}")
}

/// A browser's file input never tells the page where a file is, and the path
/// is what finds the subtitles beside it.
pub async fn pick_video() -> Result<Option<String>, String> {
    let out = tokio::process::Command::new("zenity")
        .args([
            "--file-selection",
            "--title=Choose a video",
            "--file-filter=Video | *.mkv *.mp4 *.webm *.avi *.mov *.m4v *.ts",
            "--file-filter=All files | *",
        ])
        .output()
        .await
        .map_err(|e| format!("Cannot open a file dialog: {e}"))?;
    if !out.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok((!path.is_empty()).then_some(path))
}
