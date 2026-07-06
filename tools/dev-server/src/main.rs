//! 開発専用の極小静的ファイルサーバ(std のみ・依存なし)。製品には含めない。
//! 使い方: dev-server [root_dir] [port]   既定 root=web, port=8080

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};

fn main() {
    let mut args = std::env::args().skip(1);
    let root = args.next().unwrap_or_else(|| "web".to_string());
    let port: u16 = args.next().and_then(|s| s.parse().ok()).unwrap_or(8080);
    let root = PathBuf::from(root);

    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind failed");
    println!("dev-server: http://127.0.0.1:{port}/ serving {}", root.display());

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let _ = handle(s, &root);
            }
            Err(e) => eprintln!("conn error: {e}"),
        }
    }
}

fn handle(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let raw_path = line.split_whitespace().nth(1).unwrap_or("/");
    let url_path = raw_path.split('?').next().unwrap_or("/");

    // パスを正規化し、root 外への脱出(..)を拒否
    let rel = url_path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let mut safe = PathBuf::new();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => safe.push(c),
            _ => return respond(&mut stream, 400, "text/plain", b"bad path"),
        }
    }
    let full = root.join(&safe);

    match fs::read(&full) {
        Ok(body) => respond(&mut stream, 200, content_type(&full), &body),
        Err(_) => respond(&mut stream, 404, "text/plain", b"not found"),
    }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

fn respond(stream: &mut TcpStream, status: u16, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}
