#!/bin/bash

# Helper script to launch 2 local alternate registries, for testing purpose

set -euo pipefail

if [ "$(command -v podman)" ]; then
	CONTAINER=podman
elif [ "$(command -v docker)" ]; then
	CONTAINER=docker
else
	echo "[-] Please install docker or podman."
	exit 1
fi

# Run alternate registries
$CONTAINER rm -f -t0 public-registry || true
$CONTAINER rm -f -t0 private-registry || true
$CONTAINER run --rm -it -d -p 8000:8000 --name public-registry -e KELLNR_REGISTRY__AUTH_REQUIRED=false ghcr.io/kellnr/kellnr:5.0.0
$CONTAINER run --rm -it -d -p 8001:8000 --name private-registry -e KELLNR_REGISTRY__AUTH_REQUIRED=true -e KELLNR_ORIGIN__PORT=8001 ghcr.io/kellnr/kellnr:5.0.0

export CARGO_REGISTRIES_PUBLIC_REGISTRY_TOKEN="Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
export CARGO_REGISTRIES_PUBLIC_REGISTRY_INDEX="sparse+http://127.0.0.1:8000/api/v1/crates/"

export CARGO_REGISTRIES_PRIVATE_REGISTRY_TOKEN="Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
export CARGO_REGISTRIES_PRIVATE_REGISTRY_INDEX="sparse+http://127.0.0.1:8001/api/v1/crates/"

# Push crate to `public-registry`
cd "$(mktemp -d)"
cargo init external --registry public-registry
cd external
cargo publish --no-verify --allow-dirty --registry public-registry

# Push crate to `private-registry`
cd "$(mktemp -d)"
cargo init external2 --registry private-registry
cd external2
cargo publish --no-verify --allow-dirty --registry private-registry

# Check
curl --fail-with-body http://127.0.0.1:8000/api/v1/crates/ex/te/external
curl --fail-with-body -H "Authorization: Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD" http://127.0.0.1:8001/api/v1/crates/ex/te/external2

echo -e "\n\nhttp://127.0.0.1:8000"
echo -e "http://127.0.0.1:8001"

echo '
---------------- ~/.cargo/config.toml
[registry]
global-credential-providers = ["cargo:token"]

[registries]
public-registry = { index = "sparse+http://127.0.0.1:8000/api/v1/crates/" }

[registries.private-registry]
index = "sparse+http://127.0.0.1:8001/api/v1/crates/"
token = "Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
----------------
'
