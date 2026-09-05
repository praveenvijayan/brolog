#!/bin/sh
set -eu
case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) echo 'Use the Windows direct download from GitHub Releases.' >&2; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo 'Unsupported architecture' >&2; exit 1;; esac
install_dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
mkdir -p "$install_dir"
tmp_file=$(mktemp "$install_dir/.brolog.XXXXXX")
trap 'rm -f "$tmp_file"' EXIT HUP INT TERM
curl -fL "https://github.com/praveenvijayan/brolog/releases/latest/download/brolog-$os-$arch" -o "$tmp_file"
chmod +x "$tmp_file"
mv "$tmp_file" "$install_dir/brolog"
echo "Installed $install_dir/brolog"
exec "$install_dir/brolog"
