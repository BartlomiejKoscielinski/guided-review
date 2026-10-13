//! The GitLab project of a repository, from its `origin` remote (F-19.6): https and ssh forms,
//! only on the configured server's host.

/// `mobile/mobile-app` for `https://gitlab.example.com/mobile/mobile-app.git`,
/// `git@gitlab.example.com:mobile/mobile-app.git` or `ssh://git@gitlab.example.com:2222/…`.
/// `None` when the remote is on another host or has no `group/project` path. A server with a
/// sub-path (`https://example.com/gitlab`) drops that prefix from https remotes.
pub fn project_from_remote(remote: &str, server: &str) -> Option<String> {
    let server = reqwest::Url::parse(server.trim()).ok()?;
    let host = server.host_str()?.to_lowercase();
    let remote = remote.trim();
    let path = if let Some(url) = reqwest::Url::parse(remote)
        .ok()
        .filter(reqwest::Url::has_host)
    {
        if url.host_str()?.to_lowercase() != host {
            return None;
        }
        let path = url.path();
        match url.scheme() {
            "https" | "http" => {
                let prefix = server.path().trim_end_matches('/');
                path.strip_prefix(prefix).unwrap_or(path).to_owned()
            }
            "ssh" | "git+ssh" => path.to_owned(),
            _ => return None,
        }
    } else {
        // scp-like: `[user@]host:group/project.git`
        let (user_host, path) = remote.split_once(':')?;
        let remote_host = user_host.rsplit('@').next()?;
        if remote_host.to_lowercase() != host {
            return None;
        }
        path.to_owned()
    };
    let path = path.trim_matches('/');
    let path = path
        .strip_suffix(".git")
        .unwrap_or(path)
        .trim_end_matches('/');
    (path.contains('/') && !path.split('/').any(str::is_empty)).then(|| path.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: &str = "https://gitlab.example.com";

    #[test]
    fn f19_6_project_from_https_and_ssh_remotes() {
        for remote in [
            "https://gitlab.example.com/mobile/mobile-app.git",
            "https://gitlab.example.com/mobile/mobile-app",
            "https://user@gitlab.example.com/mobile/mobile-app.git/",
            "git@gitlab.example.com:mobile/mobile-app.git",
            "ssh://git@gitlab.example.com:2222/mobile/mobile-app.git",
            "ssh://git@GitLab.Example.com/mobile/mobile-app",
        ] {
            assert_eq!(
                project_from_remote(remote, SERVER).as_deref(),
                Some("mobile/mobile-app"),
                "{remote}"
            );
        }
        assert_eq!(
            project_from_remote("git@gitlab.example.com:a/b/c.git", SERVER).as_deref(),
            Some("a/b/c")
        );
    }

    #[test]
    fn f19_6_server_sub_path_and_other_hosts() {
        assert_eq!(
            project_from_remote(
                "https://example.com/gitlab/mobile/app.git",
                "https://example.com/gitlab/"
            )
            .as_deref(),
            Some("mobile/app")
        );
        for remote in [
            "https://github.com/mobile/mobile-app.git",
            "git@github.com:mobile/mobile-app.git",
            "https://gitlab.example.com/only-one",
            "C:\\Repos\\mobile-app",
            "",
        ] {
            assert_eq!(project_from_remote(remote, SERVER), None, "{remote}");
        }
        assert_eq!(
            project_from_remote(
                "https://localhost:8443/sandbox/gr-sandbox.git",
                "https://localhost:8443"
            )
            .as_deref(),
            Some("sandbox/gr-sandbox")
        );
    }
}
