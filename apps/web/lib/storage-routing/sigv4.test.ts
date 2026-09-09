import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalQueryString,
  canonicalUri,
  presign,
  rfc3986Encode,
  signingKey,
} from "./sigv4";

/**
 * Known-answer vector from the AWS documentation's worked example for
 * query-string (presigned URL) authentication:
 *
 *   GET https://examplebucket.s3.amazonaws.com/test.txt
 *   X-Amz-Expires=86400, 20130524T000000Z, us-east-1/s3
 *   AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
 *
 * Every intermediate is asserted, not just the signature, so a failure names
 * the step that broke.
 */
describe("SigV4 presign — AWS published vector", () => {
  const result = presign({
    method: "GET",
    endpoint: "https://examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    region: "us-east-1",
    service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expiresInSeconds: 86400,
    now: new Date("2013-05-24T00:00:00Z"),
  });

  it("builds the documented canonical request", () => {
    expect(result.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host",
        "host:examplebucket.s3.amazonaws.com",
        "",
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n"),
    );
  });

  it("builds the documented string to sign", () => {
    expect(result.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04",
      ].join("\n"),
    );
  });

  it("produces the documented signature", () => {
    expect(result.signature).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("puts the signature last in the URL, after every signed parameter", () => {
    expect(result.url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("SigV4 signing key derivation", () => {
  /**
   * The published vector above already pins this chain — it cannot produce the
   * documented signature unless the key derivation is exactly right. What this
   * adds is a guard against someone "simplifying" the four HMAC rounds later:
   * it re-derives the key with a second, deliberately literal implementation
   * and requires the two to agree, so dropping a round or reordering
   * region/service fails here with a clear name instead of only showing up as
   * a 403 from a real bucket.
   */
  it("is the literal four-round AWS4 chain, in order", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const kDate = createHmac("sha256", `AWS4${secret}`).update("20150830").digest();
    const kRegion = createHmac("sha256", kDate).update("us-east-1").digest();
    const kService = createHmac("sha256", kRegion).update("iam").digest();
    const expected = createHmac("sha256", kService).update("aws4_request").digest("hex");

    expect(signingKey(secret, "20150830", "us-east-1", "iam").toString("hex")).toBe(expected);
  });

  it("changes when any one of date, region or service changes", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const base = signingKey(secret, "20150830", "us-east-1", "s3").toString("hex");
    expect(signingKey(secret, "20150831", "us-east-1", "s3").toString("hex")).not.toBe(base);
    expect(signingKey(secret, "20150830", "us-west-2", "s3").toString("hex")).not.toBe(base);
    expect(signingKey(secret, "20150830", "us-east-1", "iam").toString("hex")).not.toBe(base);
  });
});

describe("RFC 3986 encoding", () => {
  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(rfc3986Encode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("encodes spaces as %20, never +", () => {
    expect(rfc3986Encode("robot photo.jpg")).toBe("robot%20photo.jpg");
  });

  it("keeps slashes as separators in a path but encodes them inside a segment", () => {
    expect(canonicalUri("/bucket/orgs/2024/Drive Team's plan.pdf")).toBe(
      "/bucket/orgs/2024/Drive%20Team%27s%20plan.pdf",
    );
    expect(rfc3986Encode("a/b")).toBe("a%2Fb");
  });
});

describe("canonical query string", () => {
  it("sorts by encoded key", () => {
    expect(canonicalQueryString({ b: "2", a: "1", C: "3" })).toBe("C=3&a=1&b=2");
  });

  it("encodes values", () => {
    expect(canonicalQueryString({ "response-content-disposition": 'attachment; filename="a b"' })).toBe(
      "response-content-disposition=attachment%3B%20filename%3D%22a%20b%22",
    );
  });
});
