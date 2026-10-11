//! `token set|delete`: the GitLab token in Windows Credential Manager (service `GuidedReview`,
//! account `<host>`, the entry the app uses too). Typed hidden; only the masked form is shown.

use guided_review_lib::os::credentials::{self, Token};

use crate::{Args, server_host};

pub fn set(args: &Args) -> Result<String, String> {
    let host = server_host(args.required("server")?)?;
    let typed = rpassword::prompt_password(format!(
        "GitLab personal access token for {host} (scope api; input hidden): "
    ))
    .map_err(|error| format!("reading the token failed ({error}); run this in a terminal"))?;
    let token = Token::new(&typed).map_err(|error| error.to_string())?;
    credentials::save(&host, &token).map_err(|error| error.to_string())?;
    Ok(format!(
        "token {} stored in Windows Credential Manager (GuidedReview / {host})",
        token.masked()
    ))
}

pub fn delete(args: &Args) -> Result<String, String> {
    let host = server_host(args.required("server")?)?;
    match credentials::delete(&host).map_err(|error| error.to_string())? {
        true => Ok(format!("token for {host} removed from Credential Manager")),
        false => Ok(format!("no token for {host} was stored")),
    }
}

/// The stored token, for checks that need one.
pub fn stored(host: &str) -> Result<Option<Token>, String> {
    credentials::load(host).map_err(|error| error.to_string())
}
