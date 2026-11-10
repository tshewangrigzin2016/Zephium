//! The client against a small streamable HTTP server written by hand, so the
//! wire format is checked independently of the SDK's own server.
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use zephium_mcp::oauth::{HttpAuth, HttpServer};
use zephium_mcp::{Endpoint, McpError, McpSession, CALL};

async fn serve(listener: tokio::net::TcpListener, token: Option<&'static str>) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 4096];
            let (head, body) = loop {
                let Ok(read) = socket.read(&mut chunk).await else {
                    return;
                };
                if read == 0 {
                    return;
                }
                buffer.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&buffer).into_owned();
                if let Some(end) = text.find("\r\n\r\n") {
                    let head = text[..end].to_owned();
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    while buffer.len() < end + 4 + length {
                        let Ok(read) = socket.read(&mut chunk).await else {
                            return;
                        };
                        if read == 0 {
                            return;
                        }
                        buffer.extend_from_slice(&chunk[..read]);
                    }
                    break (
                        head,
                        String::from_utf8_lossy(&buffer[end + 4..end + 4 + length]).into_owned(),
                    );
                }
            };
            let reply = |status: &str, headers: &str, body: &str| {
                format!("HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
            };
            let base = format!("http://{}", socket.local_addr().unwrap());
            let oauth = matches!(token, Some("oauth-good" | "oauth-bad"));
            let authorized = token.is_none_or(|t| {
                let t = if oauth { "fresh-token" } else { t };
                head.lines()
                    .any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {t}")))
            });
            let json_reply = |body: Value| {
                reply(
                    "200 OK",
                    "content-type: application/json\r\n",
                    &body.to_string(),
                )
            };
            let response = if oauth && head.starts_with("GET /.well-known/oauth-protected-resource")
            {
                json_reply(
                    json!({"resource": format!("{base}/mcp"), "authorization_servers": [base]}),
                )
            } else if oauth && head.starts_with("GET /.well-known/oauth-authorization-server") {
                json_reply(
                    json!({"issuer": base, "authorization_endpoint": format!("{base}/authorize"), "token_endpoint": format!("{base}/token"), "response_types_supported": ["code"], "code_challenge_methods_supported": ["S256"]}),
                )
            } else if oauth && head.starts_with("POST /token ") {
                assert!(body.contains("grant_type=refresh_token"));
                assert!(body.contains("refresh_token=old-refresh"));
                if token == Some("oauth-bad") {
                    reply(
                        "400 Bad Request",
                        "content-type: application/json\r\n",
                        r#"{"error":"invalid_grant"}"#,
                    )
                } else {
                    json_reply(
                        json!({"access_token": "fresh-token", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "rotated-refresh"}),
                    )
                }
            } else if !head.starts_with("POST") {
                reply("405 Method Not Allowed", "", "")
            } else if !authorized {
                reply("401 Unauthorized", "www-authenticate: Bearer\r\n", "")
            } else {
                let message: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let id = message["id"].clone();
                let ticktick = token == Some("ticktick-test-token");
                let result = match message["method"].as_str() {
                    _ if id.is_null() => None,
                    Some("initialize") => Some(
                        json!({"protocolVersion": "2025-11-25", "capabilities": {"tools": {}}, "serverInfo": {"name": if ticktick { "ticktick" } else { "http-fixture" }, "version": "0.1.0"}}),
                    ),
                    Some("tools/list") => Some(
                        json!({"tools": [{"name": if ticktick { "get_projects" } else { "ping" }, "description": "Read projects.", "inputSchema": {"type": "object"}}]}),
                    ),
                    Some("tools/call") => Some(
                        json!({"content": [{"type": "text", "text": if ticktick { "[{\"id\":\"inbox\",\"name\":\"Inbox\"}]" } else { "pong" }}]}),
                    ),
                    _ => {
                        let error = json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Method not found"}}).to_string();
                        let _ = socket
                            .write_all(
                                reply(
                                    "200 OK",
                                    "content-type: application/json\r\nmcp-session-id: s1\r\n",
                                    &error,
                                )
                                .as_bytes(),
                            )
                            .await;
                        return;
                    }
                };
                match result {
                    None => reply("202 Accepted", "", ""),
                    Some(result) => reply(
                        "200 OK",
                        "content-type: application/json\r\nmcp-session-id: s1\r\n",
                        &json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string(),
                    ),
                }
            };
            let _ = socket.write_all(response.as_bytes()).await;
        });
    }
}

async fn server(token: Option<&'static str>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(serve(listener, token));
    format!("http://127.0.0.1:{port}/mcp")
}

#[tokio::test]
async fn an_http_server_answers_over_json() {
    let url = server(None).await;
    let session = McpSession::connect(&Endpoint::Http(HttpServer {
        url,
        auth: HttpAuth::None,
    }))
    .await
    .expect("connects");
    assert_eq!(session.info().name.as_deref(), Some("http-fixture"));
    let tools = session.tools().await.unwrap();
    assert_eq!(tools[0].name, "ping");
    let pong = session
        .call("ping", Default::default(), CALL)
        .await
        .unwrap();
    assert_eq!(pong.text, "pong");
}

async fn rejects_oversized_response(chunked: bool) {
    for (status, limit) in [
        ("200 OK", 16 * 1024 * 1024),
        ("500 Internal Server Error", 64 * 1024),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let worker = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                connections.spawn(async move {
                    let mut request = [0u8; 4096];
                    if socket.read(&mut request).await.unwrap_or(0) == 0 {
                        return;
                    }
                    let framing = if chunked {
                        "transfer-encoding: chunked\r\n".to_owned()
                    } else {
                        format!("content-length: {}\r\n", limit + 1)
                    };
                    let headers = format!(
                        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\n{framing}connection: close\r\n\r\n"
                    );
                    if socket.write_all(headers.as_bytes()).await.is_err() {
                        return;
                    }
                    if chunked {
                        let body = vec![b' '; 64 * 1024];
                        let head = format!("{:x}\r\n", body.len());
                        for _ in 0..=limit / body.len() {
                            if socket.write_all(head.as_bytes()).await.is_err()
                                || socket.write_all(&body).await.is_err()
                                || socket.write_all(b"\r\n").await.is_err()
                            {
                                return;
                            }
                        }
                    }
                    // Keep the response unfinished so buffering cannot look like rejection.
                    std::future::pending::<()>().await;
                });
            }
        });
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            McpSession::connect(&Endpoint::Http(HttpServer {
                url,
                auth: HttpAuth::None,
            })),
        )
        .await;
        worker.abort();
        let _ = worker.await;
        assert_eq!(
            result.map(|connection| connection.err()),
            Ok(Some(McpError::Protocol)),
            "{status}, chunked={chunked}"
        );
    }
}

#[tokio::test]
async fn oversized_content_length_is_refused_before_reading_the_body() {
    rejects_oversized_response(false).await;
}

#[tokio::test]
async fn oversized_chunked_body_is_refused_before_the_response_finishes() {
    rejects_oversized_response(true).await;
}

#[tokio::test]
async fn a_bearer_is_sent_and_a_refusal_asks_for_sign_in() {
    let url = server(Some("secret")).await;
    let open = McpSession::connect(&Endpoint::Http(HttpServer {
        url: url.clone(),
        auth: HttpAuth::Bearer("secret".into()),
    }))
    .await
    .expect("connects with the token");
    assert_eq!(open.tools().await.unwrap().len(), 1);
    let refused = McpSession::connect(&Endpoint::Http(HttpServer {
        url,
        auth: HttpAuth::None,
    }))
    .await;
    assert_eq!(refused.err(), Some(McpError::Unauthorized));
}

/// TickTick's streamable HTTP shape: bearer auth, named task tools and JSON results.
/// This fixture contains no account data and performs no live TickTick requests.
#[tokio::test]
async fn ticktick_style_bearer_server_reconnects_and_lists_tools() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let worker = tokio::spawn(serve(listener, Some("ticktick-test-token")));
    for _ in 0..2 {
        let session = McpSession::connect(&Endpoint::Http(HttpServer {
            url: url.clone(),
            auth: HttpAuth::Bearer("ticktick-test-token".into()),
        }))
        .await
        .unwrap();
        let tools = session.tools().await.unwrap();
        assert_eq!(tools[0].name, "get_projects");
        let result = session
            .call("get_projects", Default::default(), CALL)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&result.text).unwrap()[0]["id"],
            "inbox"
        );
        session.close().await;
    }
    worker.abort();
    let _ = worker.await;
}

#[tokio::test]
async fn oauth_refresh_persists_rotations_and_rejection_needs_sign_in() {
    use std::sync::Arc;
    use zephium_mcp::oauth::{MemoryTokens, TokenStore};
    for mode in ["oauth-good", "oauth-bad"] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let worker = tokio::spawn(serve(listener, Some(mode)));
        let tokens = Arc::new(MemoryTokens::default());
        tokens.save(&json!({"client_id": "test-client", "token_response": {"access_token": "expired-token", "token_type": "Bearer", "expires_in": 1, "refresh_token": "old-refresh"}, "granted_scopes": [], "token_received_at": 1, "issuer": base}).to_string());
        let result = McpSession::connect(&Endpoint::Http(HttpServer {
            url: format!("{base}/mcp"),
            auth: HttpAuth::OAuth(tokens.clone()),
        }))
        .await;
        if mode == "oauth-good" {
            let session = result.expect("refresh and connect");
            assert_eq!(session.tools().await.unwrap().len(), 1);
            let saved: Value = serde_json::from_str(&tokens.load().unwrap()).unwrap();
            assert_eq!(saved["token_response"]["refresh_token"], "rotated-refresh");
            session.close().await;
        } else {
            assert_eq!(result.err(), Some(McpError::Unauthorized));
        }
        worker.abort();
        let _ = worker.await;
    }
}
