# Sourced by scripts/cloudflare-build*.sh. Those scripts are upstream's Cloudflare
# build commands: they install Rust (rustup), wasm-pack and Bun into $HOME when
# missing, add a rustup target, and run `npm ci` / `bun install` with lifecycle
# scripts on and the caches in $HOME. That is fine on a throwaway CI builder and
# wrong on a workstation, so they refuse to run unless CI or CF_PAGES is set
# (Cloudflare Pages sets CF_PAGES=1; GitHub Actions sets CI=true). Locally, use the
# contained steps in JWC.md instead.
if [ -z "${CI:-}" ] && [ -z "${CF_PAGES:-}" ]; then
  echo "$(basename "$0"): CI-only (installs toolchains and caches into \$HOME); set CI=1 on a throwaway builder, or see JWC.md for the local build." >&2
  exit 1
fi
