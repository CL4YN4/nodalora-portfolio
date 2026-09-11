# Nodalora Portfolio

This repository is the public `CL4YN4/nodalora-portfolio` fork of
[Wealthfolio](https://github.com/wealthfolio/wealthfolio). It is a separately
branded distribution for the Nodalora product. Wealthfolio is a trademark of
Teymz Inc.; this fork is not official Wealthfolio and is not sponsored,
certified, or endorsed by Teymz Inc.

## Distribution boundary

The fork contains the local portfolio client and the thin Nodalora observation
addon. It deliberately excludes the hosted Nodalora service, its PostgreSQL
database, tenant secrets, model provider, and application credentials. The addon
communicates with Nodalora only through the versioned HTTPS contract:

```text
POST /api/v1/source-connections/{sourceConnectionId}/credentials
POST /api/v1/source-connections/{sourceConnectionId}/portfolio-observations
  Authorization: Bearer <revocable-source-credential>
```

The credential is issued by the owning Investor, stored only as a hash by
Nodalora, and scoped to one Source Connection. The fork's local data remains in
the isolated SQLite file `/data/wealthfolio.db`; it is never mounted into the
Nodalora service.

## Build and release

The canonical hosted artifact is the OCI image published to
`ghcr.io/cl4yn4/nodalora-portfolio`. GitHub Actions builds `linux/amd64` and
`linux/arm64` from this source, publishes BuildKit provenance and SBOM
attestations, keylessly signs the resulting OCI index digest, and attaches the
digest plus a SHA-256 checksum to the GitHub release. Deployments must pin the
full digest, not `latest` or a semver tag. Developer desktop builds are for
testing and are not canonical releases.

The tagged release also builds the public addon and attaches its checksum. It
requires the repository's non-secret `NODALORA_API_HOST` variable, which writes
the exact allowed HTTPS hostname into the addon manifest before bundling. This
prevents release artifacts from shipping the reserved documentation host or
claiming support for arbitrary runtime endpoints.

The upstream `LICENSE`, `TRADEMARKS.md`, and history are retained. Every
modified network-served build must keep its corresponding source public under
AGPL-3.0. A release also records the exact upstream baseline, source revision,
and release tag. Before commercial or real-data use, complete licensing,
compatibility, security, privacy, and specialist legal review.

## Upstream synchronization and rollback

Upstream changes are reviewed and synchronized deliberately. Release tags are
cut only after the fork's compatibility checks pass. Security fixes are rebuilt
and signed as new digests; they are never hidden behind a mutable tag. Rollback
repins the deployment to the last known-good digest and does not downgrade the
SQLite database in place.
