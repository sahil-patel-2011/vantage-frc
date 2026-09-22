import { describe, expect, it } from "vitest";
import {
  pickReplayableHeaders,
  sessionReplayHeaders,
  xsrfHeaderFromCookies,
  type OnshapeSessionCookie,
} from "../src/onshape-session-store";

/**
 * Writes through a captured browser session used to work by luck.
 *
 * Onshape uses double-submit CSRF: the token is in the `XSRF-TOKEN` cookie and
 * must come back as `X-XSRF-TOKEN`. The session capture only ever *observed*
 * headers on whatever requests the live web client happened to make, and the
 * client sends that header on writes — so a login where the person just looked
 * at their documents stored no header at all. Every later write then failed
 * 401 while reads kept working, which looks exactly like an expired session
 * and is not one.
 *
 * Confirmed against a live session on 2026-09-18: POST /api/v6/documents
 * returns 401 without the header and 200 with it.
 */

function cookie(name: string, value: string): OnshapeSessionCookie {
  return {
    name,
    value,
    domain: ".onshape.com",
    path: "/",
    expires: 0,
    httpOnly: false,
    secure: true,
  };
}

describe("the CSRF token is derived, not hoped for", () => {
  it("builds the header from the cookie the capture always stores", () => {
    expect(xsrfHeaderFromCookies([cookie("XSRF-TOKEN", "abc123")])).toEqual({
      "x-xsrf-token": "abc123",
    });
  });

  it("decodes a percent-encoded token, because drivers differ", () => {
    expect(xsrfHeaderFromCookies([cookie("XSRF-TOKEN", "a%2Bb%3Dc")])).toEqual({
      "x-xsrf-token": "a+b=c",
    });
  });

  it("keeps a token containing a stray percent rather than dropping it", () => {
    // decodeURIComponent throws on a lone '%'; a token is too important to lose.
    expect(xsrfHeaderFromCookies([cookie("XSRF-TOKEN", "100%pure")])).toEqual({
      "x-xsrf-token": "100%pure",
    });
  });

  it("matches the cookie name whatever case it arrives in", () => {
    expect(xsrfHeaderFromCookies([cookie("xsrf-token", "x1")])["x-xsrf-token"]).toBe("x1");
  });

  it("says nothing when there is no token and nothing when there are no cookies", () => {
    expect(xsrfHeaderFromCookies([cookie("other", "v")])).toEqual({});
    expect(xsrfHeaderFromCookies([cookie("XSRF-TOKEN", "  ")])).toEqual({});
    expect(xsrfHeaderFromCookies([])).toEqual({});
    expect(xsrfHeaderFromCookies(undefined)).toEqual({});
  });
});

describe("replay headers", () => {
  it("fills the gap a read-only login leaves", () => {
    // The case that was broken: cookies captured, no header observed.
    expect(
      sessionReplayHeaders({ headers: {}, cookies: [cookie("XSRF-TOKEN", "derived")] }),
    ).toEqual({ "x-xsrf-token": "derived" });
  });

  it("lets an observed header win over the derived one", () => {
    // If the live client sent something more specific, it knows better.
    expect(
      sessionReplayHeaders({
        headers: { "x-xsrf-token": "observed" },
        cookies: [cookie("XSRF-TOKEN", "derived")],
      }),
    ).toEqual({ "x-xsrf-token": "observed" });
  });

  it("still never replays cookie or authorization", () => {
    // The original rule this sits on top of.
    expect(
      pickReplayableHeaders({ cookie: "a=b", authorization: "Bearer x", "x-csrf-token": "keep" }),
    ).toEqual({ "x-csrf-token": "keep" });
  });

  it("returns nothing when there is neither a header nor a cookie", () => {
    expect(sessionReplayHeaders({})).toEqual({});
  });
});
