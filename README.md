# Crates-io: Simplify Dependency Management in Rust & VSCode

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/BarbossHack.crates-io)](https://img.shields.io/visual-studio-marketplace/v/BarbossHack.crates-io)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/BarbossHack.crates-io)](https://img.shields.io/visual-studio-marketplace/i/BarbossHack.crates-io)
[![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/BarbossHack.crates-io)](https://img.shields.io/visual-studio-marketplace/r/BarbossHack.crates-io)
[![GitHub stars](https://img.shields.io/github/stars/BarbossHack/crates-io.svg)](https://github.com/BarbossHack/crates-io/stargazers)

## Crates-io

Welcome to **Crates-io**, the ultimate Rust extension for VSCode! Simplify your dependency management with ease while using Cargo.toml for your project.

## Key Features

Crates-io offers a range of powerful features to streamline your Rust development workflow:

1. **Version Information**: Crates-io provides comprehensive version information to keep you informed about the crates in your project. This includes a tooltip with detailed version details and inline visual feedback for quick reference and decision-making.
   ![Tooltip with Version Information](https://github.com/BarbossHack/crates-io/raw/master/screenshots/tooltip.png)

2. **Shortcut Commands**: Update all dependencies with just one command for a seamless workflow.

3. **Docs.rs integration**: Explore comprehensive documentation for Rust, including crates, libraries, and more, with the seamless integration of [Docs.rs](https://docs.rs/).

4. **Alternate registries**: Crates-io support your alternate registries without any configuration.

## Getting Started

Using Crates-io is incredibly simple. Just install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=BarbossHack.crates-io), and you're ready to go!

## Configuration Options

While Crates-io works out-of-the-box without any configuration, we also offer a few customizable options:

### settings.json

- `crates.listPreReleases`: Enable this option to list pre-release versions in hover and decorations. By default, it is set to false.

- `crates.indexServerURL`: Specify a custom URL for the crates.io index server. The default value connects to the official index.

- `crates.errorDecorator`: Customize the text displayed when a dependency has errors. The default is `❗️❗️❗`.

- `crates.compatibleDecorator`: Define the text template to show when a dependency is semver compatible. `${version}` will be replaced by the latest version info. The default is `✅`.

- `crates.incompatibleDecorator`: Set the text template to show when a dependency is not semver compatible. `${version}` will be replaced by the latest version info. The default is `❌ ${version}`.

### Cargo.toml

- `dependency = "*" # crates: disable-check`: Disable version check for this specific dependency.
