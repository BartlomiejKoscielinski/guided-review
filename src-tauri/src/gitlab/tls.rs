//! TLS for the GitLab client (S6): the Windows certificate store through reqwest's default
//! rustls + rustls-platform-verifier, so an internal CA trusted by Windows works without
//! configuration. Errors are classified for messages and the field report.
//!
//! Windows behaviour of the platform verifier (0.7.1): the chain is built by Windows from the
//! system stores (incl. enterprise and user roots); revocation is checked for the end
//! certificate only, and an unknown or offline revocation status is ignored.

use std::error::Error;

/// Which TLS implementation a client uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsBackend {
    /// rustls with the platform verifier (Windows certificate store). The app's choice.
    Platform,
    /// SChannel through native-tls; only in the field probe, for comparison.
    #[cfg(feature = "field-probe")]
    Native,
}

/// Why a TLS connection failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TlsProblem {
    /// The chain doesn't end in a root Windows trusts (internal CA not installed).
    UnknownIssuer,
    Expired,
    NotYetValid,
    /// The certificate is for another host name.
    NameMismatch,
    Revoked,
    /// Revocation could not be checked (offline CRL/OCSP).
    RevocationUnknown,
    /// The certificate isn't valid for TLS server authentication.
    WrongUsage,
    Other,
}

/// Finds the TLS problem in an error's source chain: a rustls certificate error (platform
/// verifier) or a Windows certificate/SChannel error code (native-tls).
pub fn classify(error: &(dyn Error + 'static)) -> Option<TlsProblem> {
    let mut current: Option<&(dyn Error + 'static)> = Some(error);
    while let Some(error) = current {
        if let Some(rustls_error) = error.downcast_ref::<rustls::Error>() {
            return Some(from_rustls(rustls_error));
        }
        if let Some(io) = error.downcast_ref::<std::io::Error>() {
            if let Some(problem) = io.raw_os_error().and_then(from_windows_code) {
                return Some(problem);
            }
            // `io::Error::source` skips the wrapped error itself (tokio-rustls wraps
            // `rustls::Error` this way), so look inside explicitly.
            if let Some(problem) = io.get_ref().and_then(|inner| classify(inner)) {
                return Some(problem);
            }
        }
        // native-tls hides its `io::Error` (no source, no accessor); its text still ends with
        // std's "(os error <code>)".
        if let Some(problem) = os_error_code(&error.to_string()).and_then(from_windows_code) {
            return Some(problem);
        }
        current = error.source();
    }
    None
}

/// The code in std's `io::Error` text: "… (os error -2146762487)".
fn os_error_code(text: &str) -> Option<i32> {
    let start = text.rfind("(os error ")? + "(os error ".len();
    let end = start + text[start..].find(')')?;
    text[start..end].trim().parse().ok()
}

fn from_rustls(error: &rustls::Error) -> TlsProblem {
    use rustls::CertificateError as C;
    match error {
        rustls::Error::InvalidCertificate(certificate) => match certificate {
            C::UnknownIssuer => TlsProblem::UnknownIssuer,
            C::Expired | C::ExpiredContext { .. } => TlsProblem::Expired,
            C::NotValidYet | C::NotValidYetContext { .. } => TlsProblem::NotYetValid,
            C::NotValidForName | C::NotValidForNameContext { .. } => TlsProblem::NameMismatch,
            C::Revoked => TlsProblem::Revoked,
            C::UnknownRevocationStatus => TlsProblem::RevocationUnknown,
            C::InvalidPurpose | C::InvalidPurposeContext { .. } => TlsProblem::WrongUsage,
            _ => TlsProblem::Other,
        },
        _ => TlsProblem::Other,
    }
}

/// Windows certificate (`CERT_E_*`, `CRYPT_E_*`) and SChannel (`SEC_E_*`) error codes.
fn from_windows_code(code: i32) -> Option<TlsProblem> {
    // HRESULTs are reported as negative i32 values.
    match code as u32 {
        0x800B_0109 | 0x8009_0325 => Some(TlsProblem::UnknownIssuer),
        0x800B_0101 | 0x8009_0328 => Some(TlsProblem::Expired),
        0x8009_0322 | 0x800B_010F | 0x800B_0114 => Some(TlsProblem::NameMismatch),
        0x8009_2010 => Some(TlsProblem::Revoked),
        0x8009_2012 | 0x8009_2013 => Some(TlsProblem::RevocationUnknown),
        0x800B_0110 | 0x8009_0349 => Some(TlsProblem::WrongUsage),
        0x8009_0326 | 0x8009_0327 | 0x8009_0330 | 0x8009_0331 => Some(TlsProblem::Other),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustls::CertificateError;

    fn wrapped(inner: rustls::Error) -> std::io::Error {
        std::io::Error::other(inner)
    }

    #[test]
    fn classifies_platform_verifier_errors() {
        let cases = [
            (CertificateError::UnknownIssuer, TlsProblem::UnknownIssuer),
            (CertificateError::Expired, TlsProblem::Expired),
            (CertificateError::NotValidYet, TlsProblem::NotYetValid),
            (CertificateError::NotValidForName, TlsProblem::NameMismatch),
            (CertificateError::Revoked, TlsProblem::Revoked),
            (
                CertificateError::UnknownRevocationStatus,
                TlsProblem::RevocationUnknown,
            ),
            (CertificateError::InvalidPurpose, TlsProblem::WrongUsage),
            (CertificateError::BadSignature, TlsProblem::Other),
        ];
        for (error, problem) in cases {
            let io = wrapped(rustls::Error::InvalidCertificate(error.clone()));
            assert_eq!(classify(&io), Some(problem), "{error:?}");
        }
    }

    #[test]
    fn classifies_windows_certificate_error_codes() {
        let cases: [(u32, TlsProblem); 8] = [
            (0x800B_0109, TlsProblem::UnknownIssuer), // CERT_E_UNTRUSTEDROOT
            (0x8009_0325, TlsProblem::UnknownIssuer), // SEC_E_UNTRUSTED_ROOT
            (0x800B_0101, TlsProblem::Expired),       // CERT_E_EXPIRED
            (0x8009_0328, TlsProblem::Expired),       // SEC_E_CERT_EXPIRED
            (0x8009_0322, TlsProblem::NameMismatch),  // SEC_E_WRONG_PRINCIPAL
            (0x800B_010F, TlsProblem::NameMismatch),  // CERT_E_CN_NO_MATCH
            (0x8009_2010, TlsProblem::Revoked),       // CRYPT_E_REVOKED
            (0x8009_2013, TlsProblem::RevocationUnknown), // CRYPT_E_REVOCATION_OFFLINE
        ];
        for (code, problem) in cases {
            let io = std::io::Error::from_raw_os_error(code as i32);
            let outer = std::io::Error::other(io);
            assert_eq!(classify(&outer), Some(problem), "{code:#x}");
        }
    }

    #[test]
    fn reads_windows_codes_from_hidden_native_tls_errors() {
        #[derive(Debug)]
        struct Opaque(String);
        impl std::fmt::Display for Opaque {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
        impl Error for Opaque {}
        let hidden = Opaque(std::io::Error::from_raw_os_error(0x800B_0109_u32 as i32).to_string());
        assert_eq!(classify(&hidden), Some(TlsProblem::UnknownIssuer));
        assert_eq!(os_error_code("x (os error 10061)"), Some(10061));
        assert_eq!(os_error_code("no code"), None);
    }

    #[test]
    fn other_errors_are_not_tls_problems() {
        let refused = std::io::Error::from(std::io::ErrorKind::ConnectionRefused);
        assert_eq!(classify(&refused), None);
        let other_rustls = wrapped(rustls::Error::DecryptError);
        assert_eq!(classify(&other_rustls), Some(TlsProblem::Other));
    }
}
