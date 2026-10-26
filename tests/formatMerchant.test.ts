import { describe, expect, it } from "vitest";
import { normalizeMerchantKey } from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";

describe("formatMerchantName", () => {
  it.each([
    ["SQ *CHEX GRILL & WINGS275 PARK TERRACE DR STE", "Chex Grill & Wings"],
    ["TST* SHAKE SHACK 1234 NEW YORK NY", "Shake Shack"],
    ["WINGSTOP 1043 HOUSTON TX", "Wingstop"],
    ["PANERA BREAD #601234 AUSTIN TX", "Panera Bread"],
    ["TACO BELL #031234 LEXINGTON SC", "Taco Bell"],
    ["OLIVE GARDEN 00012345 IRMO SC", "Olive Garden"],
    ["LS PIZZA PLACE LLC (803) 555-1212", "Ls Pizza Place"],
    ["SP * GYMSHARK GYMSHARK.COM", "Gymshark"],
    ["IN-N-OUT BURGER 123 SAN JOSE CA", "In-n-out Burger"],
  ])("strips location, store numbers and processor codes: %s", (raw, clean) => {
    expect(formatMerchantName(raw)).toBe(clean);
  });

  it.each([
    ["SPOTIFY 877-778-1161 NY", "Spotify"],
    ["NETFLIX.COM 8665797172 CA", "Netflix"],
    ["HULU 877-8244858 CA", "Hulu"],
    ["OPENAI *CHATGPT SUBSCR +14158799686 CA", "Openai Chatgpt Subscr"],
    ["COMCAST CABLE COMM 800-COMCAST", "Comcast Cable Comm"],
    ["CHICK-FIL-A #01234 8035551212", "Chick-fil-A"],
  ])("removes phone numbers in every format: %s", (raw, clean) => {
    expect(formatMerchantName(raw)).toBe(clean);
  });

  it.each([
    ["PELOTON* MEMBERSHIP 866-679-9129 NY", "Peloton Membership"],
    ["TMOBILE*AUTO PAY 800-937-8997 WA", "Tmobile Auto Pay"],
    ["GEICO *AUTO 800-841-3000 DC", "Geico Auto"],
    ["DOORDASH*DASHPASS 855-431-0459", "Doordash Dashpass"],
    ["ADOBE *ADOBE 408-536-6000 CA", "Adobe"],
  ])("keeps a brand that comes before a '*': %s", (raw, clean) => {
    expect(formatMerchantName(raw)).toBe(clean);
  });

  it.each([
    ["FOREVER 21 #5521 COLUMBIA SC", "Forever 21"],
    ["PIER 1 IMPORTS", "Pier 1 Imports"],
    ["76 - SHELL 0012345", "76 - Shell"],
  ])("keeps numbers that belong to the name: %s", (raw, clean) => {
    expect(formatMerchantName(raw)).toBe(clean);
  });
});

describe("normalizeMerchantKey (merchant memory)", () => {
  it("treats every location of a place as one merchant", () => {
    const keys = ["WINGSTOP 1043 HOUSTON TX", "WINGSTOP 2210 DALLAS TX", "WINGSTOP #88 AUSTIN TX"].map(normalizeMerchantKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("keeps different Amazon services apart", () => {
    const keys = ["AMAZON PRIME*2K4AB1234", "AMZN Mktp US*2K4AB1234", "AMAZON FRESH 1234"].map(normalizeMerchantKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("keeps transfers to different people apart", () => {
    expect(normalizeMerchantKey("ZELLE TO JOHN DOE ON 10/02 REF # PP0ABC123")).not.toBe(
      normalizeMerchantKey("ZELLE TO JANE ROE ON 10/02 REF # PP0XYZ999")
    );
    expect(normalizeMerchantKey("JPMORGAN CHASE EXT TRNSFR 260924 30507479156 TALHA GILL")).not.toBe(
      normalizeMerchantKey("JPMORGAN CHASE EXT TRNSFR 260924 30507479156 SARA GILL")
    );
  });

  it("is stable when applied to its own output", () => {
    for (const m of ["WINGSTOP 1043 HOUSTON TX", "FOREVER 21 #5521 COLUMBIA SC", "NETFLIX.COM 866-579-7172 CA"]) {
      expect(normalizeMerchantKey(normalizeMerchantKey(m))).toBe(normalizeMerchantKey(m));
    }
  });
});
