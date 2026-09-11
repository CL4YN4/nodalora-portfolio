# Nodalora Portfolio addon

This thin addon runs inside the public Nodalora Portfolio distribution. It reads
only the accounts, holdings, valuations, snapshots, quotes, exchange rates, and
base currency needed to construct one versioned Portfolio Observation. It sends
that immutable JSON document to the configured Nodalora HTTPS endpoint.

The source credential is stored in Wealthfolio's addon-scoped secure secret
store and is injected by the host network broker. It is never written to
`localStorage`, the addon bundle, or the repository. Create and revoke the
credential from the owning Investor's Nodalora session.

The checked-in `api.nodalora.example` host is a reserved documentation template,
not a deployable endpoint. A releasable addon must run
`NODALORA_API_HOST=api.your-nodalora-host node scripts/configure-api-host.mjs`
before it builds, which replaces the manifest's approved host. The release
workflow requires the same hostname through the `NODALORA_API_HOST` repository
variable. The addon's configured API URL must remain on that approved HTTPS
host, and users approve it during installation.

The addon does not include Nodalora server code, a PostgreSQL client, tenant
secrets, or model integration. It does not read or mount Wealthfolio's SQLite
file directly.

Build and package it from the fork root:

```sh
pnpm --filter @cl4yn4/nodalora-portfolio-addon bundle
```
