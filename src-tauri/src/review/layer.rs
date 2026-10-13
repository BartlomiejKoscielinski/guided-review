//! MAUI layer of a changed file from its path (F-05.4, M2 decision 4, 05 › Layers). The plan,
//! the "File order" strategy and the UI tags use the same names.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Layer {
    Core,
    Infrastructure,
    /// ViewModels, services, app logic.
    App,
    /// Views.
    Xaml,
    Platforms,
    Tests,
    Resources,
    Build,
    #[default]
    Other,
}

const BUILD_EXTENSIONS: [&str; 4] = [".csproj", ".sln", ".props", ".targets"];
const BUILD_NAMES: [&str; 3] = [".gitlab-ci.yml", "global.json", "nuget.config"];

/// The first matching rule, case-insensitive. Segment rules look at folder names only, never
/// the file name. `path` is repository-relative with `/` (or `\`).
pub fn layer_of(path: &str) -> Layer {
    let lower = path.to_lowercase();
    let mut parts: Vec<&str> = lower.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    let name = parts.pop().unwrap_or_default();
    let folders = parts;
    let folder = |test: &dyn Fn(&str) -> bool| folders.iter().any(|f| test(f));

    if folder(&|f| f.contains("tests") || f == "test") {
        Layer::Tests
    } else if folder(&|f| f == "platforms") {
        Layer::Platforms
    } else if BUILD_EXTENSIONS.iter().any(|ext| name.ends_with(ext))
        || BUILD_NAMES.contains(&name)
        || name.starts_with("directory.")
    {
        Layer::Build
    } else if folder(&|f| f == "resources") || name.ends_with(".resx") {
        Layer::Resources
    } else if name.ends_with(".xaml") || name.ends_with(".xaml.cs") {
        Layer::Xaml
    } else if folder(&|f| f == "core" || f.ends_with(".core")) {
        Layer::Core
    } else if folder(&|f| f == "infrastructure" || f.ends_with(".infrastructure")) {
        Layer::Infrastructure
    } else if name.ends_with(".cs") {
        Layer::App
    } else {
        Layer::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f05_4_layer_from_path_first_match_wins() {
        let table = [
            ("tests/Mobile.Core.Tests/OrderTests.cs", Layer::Tests),
            ("src/App.UnitTests/Fakes/FakeApi.cs", Layer::Tests),
            ("test/Smoke.cs", Layer::Tests),
            ("src/Mobile.Tests/Mobile.Tests.csproj", Layer::Tests),
            (
                "src/App/Platforms/Android/MainActivity.cs",
                Layer::Platforms,
            ),
            ("src/App/Platforms/iOS/Info.plist", Layer::Platforms),
            ("src/App/App.csproj", Layer::Build),
            ("Mobile.sln", Layer::Build),
            ("Directory.Build.props", Layer::Build),
            ("Directory.Packages.props", Layer::Build),
            ("build/Signing.targets", Layer::Build),
            (".gitlab-ci.yml", Layer::Build),
            ("global.json", Layer::Build),
            ("NuGet.Config", Layer::Build),
            ("src/App/Resources/Styles/Colors.xaml", Layer::Resources),
            ("src/App/Resources/Images/logo.svg", Layer::Resources),
            ("src/App/Strings/AppResources.resx", Layer::Resources),
            ("src/App/Views/LoginPage.xaml", Layer::Xaml),
            ("src/App/Views/LoginPage.xaml.cs", Layer::Xaml),
            ("src/Mobile.Core/Orders/Order.cs", Layer::Core),
            ("src/Core/Money.cs", Layer::Core),
            (
                "src/Mobile.Infrastructure/Api/OrdersClient.cs",
                Layer::Infrastructure,
            ),
            ("src/infrastructure/Db.cs", Layer::Infrastructure),
            ("src/App/ViewModels/LoginViewModel.cs", Layer::App),
            ("src/App/MauiProgram.cs", Layer::App),
            ("src/Contests.cs", Layer::App),
            ("docs/compiled-bindings.md", Layer::Other),
            ("README.md", Layer::Other),
            ("src\\App\\Views\\Ąę Strona.xaml", Layer::Xaml),
        ];
        for (path, expected) in table {
            assert_eq!(layer_of(path), expected, "{path}");
        }
    }

    #[test]
    fn f05_4_segment_rules_ignore_the_file_name() {
        assert_eq!(layer_of("src/App/OrderServiceTests.cs"), Layer::App);
        assert_eq!(layer_of("src/App/Core.cs"), Layer::App);
        assert_eq!(layer_of("src/App/Platforms.md"), Layer::Other);
    }

    #[test]
    fn f05_4_layers_serialize_as_ui_tag_names() {
        assert_eq!(serde_json::to_value(Layer::Xaml).unwrap(), "xaml");
        assert_eq!(
            serde_json::to_value(Layer::Infrastructure).unwrap(),
            "infrastructure"
        );
    }
}
