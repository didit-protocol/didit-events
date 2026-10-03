// verifyDiditAccessToken must accept the access-token format Didit issues and nothing forged.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiditAccessToken } from "./oidc";

const ISS = "https://auth.didit.me/", CLIENT = "example-oidc-client", JWKS = "https://apx.didit.me/auth/config/jwks";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return { privateKey, jwk: { kty: "EC", crv: "secp256r1", x: jwk.x, y: jwk.y } };
}
function token(privateKey: ReturnType<typeof keyPair>["privateKey"], claims: Record<string, unknown>, dsaEncoding: "der" | "ieee-p1363" = "der") {
  const head = b64({ alg: "RS256", typ: "JWT" }), body = b64(claims);
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding });
  return `${head}.${body}.${sig.toString("base64url")}`;
}
const now = Date.now(), s = Math.floor(now / 1000);
const good = { iss: ISS, aud: CLIENT, client_id: CLIENT, sub: "ua-123", exp: s + 300, iat: s, identifier: "a@didit.me", identifier_type: "email", jti: "j", claims: [] };
const transportFor = (keys: unknown[]) => (async () => new Response(JSON.stringify({ keys }), { status: 200 })) as unknown as typeof fetch;

describe("verifyDiditAccessToken", () => {
  it("accepts Didit's real format: RS256 header, DER ECDSA P-256 signature, secp256r1 JWK", async () => {
    const { privateKey, jwk } = keyPair();
    const payload = await verifyDiditAccessToken(token(privateKey, good), `${JWKS}?a`, transportFor([jwk]), ISS, CLIENT, now);
    expect(payload.sub).toBe("ua-123");
  });
  it("also accepts a raw (JOSE) ECDSA signature", async () => {
    const { privateKey, jwk } = keyPair();
    await expect(verifyDiditAccessToken(token(privateKey, good, "ieee-p1363"), `${JWKS}?b`, transportFor([jwk]), ISS, CLIENT, now)).resolves.toBeTruthy();
  });
  it("rejects a token signed by another key", async () => {
    const a = keyPair(), b = keyPair();
    await expect(verifyDiditAccessToken(token(b.privateKey, good), `${JWKS}?c`, transportFor([a.jwk]), ISS, CLIENT, now)).rejects.toThrow("signature");
  });
  it("rejects a tampered payload", async () => {
    const { privateKey, jwk } = keyPair();
    const [h, , sig] = token(privateKey, good).split(".");
    await expect(verifyDiditAccessToken(`${h}.${b64({ ...good, sub: "attacker" })}.${sig}`, `${JWKS}?d`, transportFor([jwk]), ISS, CLIENT, now)).rejects.toThrow("signature");
  });
  it.each([
    ["wrong issuer", { iss: "https://evil.example/" }, "claims"],
    ["wrong audience", { aud: "other" }, "claims"],
    ["wrong client_id", { client_id: "other" }, "claims"],
    ["missing sub", { sub: "" }, "sub"],
    ["expired beyond skew", { exp: s - 120 }, "exp"],
    ["issued in the future", { iat: s + 30 }, "iat"],
  ])("rejects %s", async (_name, patch, reason) => {
    const { privateKey, jwk } = keyPair();
    await expect(verifyDiditAccessToken(token(privateKey, { ...good, ...patch }), `${JWKS}?${reason}${_name}`, transportFor([jwk]), ISS, CLIENT, now)).rejects.toThrow(reason);
  });
  it("rejects when the JWKS has no EC P-256 key", async () => {
    const { privateKey } = keyPair();
    await expect(verifyDiditAccessToken(token(privateKey, good), `${JWKS}?e`, transportFor([{ kty: "RSA", n: "x", e: "AQAB" }]), ISS, CLIENT, now)).rejects.toThrow("jwks_no_ec_key");
  });
});
