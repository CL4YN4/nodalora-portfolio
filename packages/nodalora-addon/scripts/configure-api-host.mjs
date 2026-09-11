import { readFile, writeFile } from "node:fs/promises";

const apiHost = process.env.NODALORA_API_HOST?.trim().toLowerCase();
if (!apiHost) {
  throw new Error("NODALORA_API_HOST is required to package a releasable addon");
}
if (apiHost.endsWith(".example")) {
  throw new Error("NODALORA_API_HOST must be a deployed HTTPS host, not an .example hostname");
}

const candidate = new URL(`https://${apiHost}`);
if (candidate.hostname !== apiHost || candidate.port || candidate.pathname !== "/") {
  throw new Error("NODALORA_API_HOST must be a hostname without a scheme, path, or port");
}

const manifestUrl = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
manifest.network.allowedHosts = [apiHost];
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Configured addon API host: ${apiHost}\n`);
