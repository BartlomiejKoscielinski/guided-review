//! Stand-in GitLab (ADR-019, `tools/standin/`): a test CA and a server certificate for
//! `https://localhost:8443`, so the app reaches the stand-in through the Windows store like it
//! reaches the on-prem internal CA.
//!
//! `cargo run --example standin_cert -- --out tools/standin/ssl`
//!
//! Writes `gitlab.crt` (leaf + CA, PEM), `gitlab.key` (PEM) and `gr-standin-ca.cer` (DER, for
//! `certutil`), and prints the lines to import and remove the CA. The CA's private key exists
//! only in this process: the imported CA can't vouch for anything but this one certificate.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "dev tool")]

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose, date_time_ymd,
};

/// Names the stand-in answers to: the PC (`localhost`) and, from M6, a runner container (`gitlab`).
const SERVER_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "gitlab"];

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args
        .iter()
        .position(|a| a == "--out")
        .and_then(|i| args.get(i + 1))
        .map_or_else(|| PathBuf::from("."), PathBuf::from);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let ca_name = format!("Guided Review Stand-in CA {stamp:x}");

    let mut ca_params = CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params
        .distinguished_name
        .push(DnType::CommonName, &ca_name);
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    ca_params.not_before = date_time_ymd(2025, 1, 1);
    ca_params.not_after = date_time_ymd(2099, 1, 1);
    let ca_key = KeyPair::generate().unwrap();
    let ca_cert = ca_params.self_signed(&ca_key).unwrap();
    let issuer = Issuer::new(ca_params, ca_key);

    let mut leaf_params = CertificateParams::new(SERVER_NAMES.map(str::to_owned).to_vec()).unwrap();
    leaf_params
        .distinguished_name
        .push(DnType::CommonName, "localhost");
    leaf_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    leaf_params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    leaf_params.not_before = date_time_ymd(2025, 1, 1);
    leaf_params.not_after = date_time_ymd(2099, 1, 1);
    let leaf_key = KeyPair::generate().unwrap();
    let leaf_cert = leaf_params.signed_by(&leaf_key, &issuer).unwrap();

    std::fs::create_dir_all(&out).unwrap();
    let chain = format!("{}{}", leaf_cert.pem(), ca_cert.pem());
    std::fs::write(out.join("gitlab.crt"), chain).unwrap();
    std::fs::write(out.join("gitlab.key"), leaf_key.serialize_pem()).unwrap();
    let cer = out.join("gr-standin-ca.cer");
    std::fs::write(&cer, ca_cert.der()).unwrap();

    println!("CA: {ca_name}");
    println!(
        "import: certutil -user -addstore Root \"{}\"",
        cer.display()
    );
    println!("remove: certutil -user -delstore Root \"{ca_name}\"");
}
