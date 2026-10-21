//! A throwaway test PKI and a local HTTPS server answering `GET /api/v4/version`, shared by
//! `tests/it/tls.rs` and the S6 spike (`examples/s6_tls_server.rs`). The CA's private key lives
//! only in memory: a CA imported into a certificate store can't sign anything once the process
//! ends.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    dead_code,
    reason = "test support"
)]

use std::net::SocketAddr;
use std::sync::Arc;

use rcgen::{
    BasicConstraints, CertificateParams, CrlDistributionPoint, DnType, ExtendedKeyUsagePurpose,
    IsCa, Issuer, KeyPair, KeyUsagePurpose, date_time_ymd,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

/// A root CA for tests.
pub struct TestCa {
    pub name: String,
    /// The CA certificate (DER), e.g. for `certutil -user -addstore Root`.
    pub der: Vec<u8>,
    issuer: Issuer<'static, KeyPair>,
}

/// Server certificate variants (S6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Leaf {
    /// For `localhost` and `127.0.0.1`, valid until 2099.
    Valid,
    /// Valid only in 2020.
    Expired,
    /// For `wrong.example` only.
    WrongName,
    /// Valid, with a CRL distribution point nobody answers (revocation status unknown).
    CrlUnreachable,
}

impl TestCa {
    pub fn new(name: &str) -> Self {
        let mut params = CertificateParams::new(Vec::<String>::new()).unwrap();
        params.distinguished_name.push(DnType::CommonName, name);
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        params.not_before = date_time_ymd(2025, 1, 1);
        params.not_after = date_time_ymd(2099, 1, 1);
        let key = KeyPair::generate().unwrap();
        let cert = params.self_signed(&key).unwrap();
        Self {
            name: name.to_owned(),
            der: cert.der().to_vec(),
            issuer: Issuer::new(params, key),
        }
    }

    /// A server certificate chain (leaf + CA) and its key.
    pub fn leaf(&self, kind: Leaf) -> (Vec<CertificateDer<'static>>, PrivateKeyDer<'static>) {
        let names = match kind {
            Leaf::WrongName => vec!["wrong.example".to_owned()],
            _ => vec!["localhost".to_owned(), "127.0.0.1".to_owned()],
        };
        let mut params = CertificateParams::new(names).unwrap();
        params
            .distinguished_name
            .push(DnType::CommonName, format!("gr-test {kind:?}"));
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        params.key_usages = vec![
            KeyUsagePurpose::DigitalSignature,
            KeyUsagePurpose::KeyEncipherment,
        ];
        let (from, to) = match kind {
            Leaf::Expired => (date_time_ymd(2020, 1, 1), date_time_ymd(2021, 1, 1)),
            _ => (date_time_ymd(2025, 1, 1), date_time_ymd(2099, 1, 1)),
        };
        params.not_before = from;
        params.not_after = to;
        if kind == Leaf::CrlUnreachable {
            params.crl_distribution_points = vec![CrlDistributionPoint {
                uris: vec!["http://127.0.0.1:9/gr-test.crl".to_owned()],
            }];
        }
        let key = KeyPair::generate().unwrap();
        let cert = params.signed_by(&key, &self.issuer).unwrap();
        let chain = vec![cert.der().clone(), CertificateDer::from(self.der.clone())];
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der()));
        (chain, key)
    }
}

/// Serves HTTPS on `127.0.0.1:<port>` (0 = any free port) until the runtime ends; every
/// request gets `200 {"version":"gr-test"}`.
pub async fn serve(
    chain: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
    port: u16,
) -> SocketAddr {
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut request = Vec::new();
                let mut buf = [0_u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match tls.read(&mut buf).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => request.extend_from_slice(&buf[..n]),
                    }
                }
                let body = r#"{"version":"gr-test"}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = tls.write_all(response.as_bytes()).await;
                let _ = tls.shutdown().await;
            });
        }
    });
    address
}
