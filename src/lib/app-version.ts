import packageJson from "../../package.json";

const packageVersion = packageJson.version;

if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error("Versione applicativa non valida in package.json");
}

export const APP_VERSION = packageVersion;
// dvns-app fork: identify the experimental deployment, not upstream, to the sources it calls.
export const APP_USER_AGENT =
  `DoveVannoINostriSoldi-dvnstest/${APP_VERSION} (+https://dvnstest.com/source.tar.gz)`;
/** Indice PA blocks our primary User-Agent at the gateway; keep this alias for IPA reads only. */
export const IPA_USER_AGENT =
  `OpenDataClient/${APP_VERSION} (dvnstest.com)`;
