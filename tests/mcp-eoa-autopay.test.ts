import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEvmEoaAutopayAllowed,
  clientFromEnv,
  EVM_EOA_AUTOPAY_ACK,
} from "../sdk/js/src/mcp.js";

const TEST_KEY = `0x${"11".repeat(32)}`;

function setLocalEnvironment() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("MOLTWORLD_ENV", "local");
  vi.stubEnv("MOLTWORLD_EVM_PRIVATE_KEY", TEST_KEY);
  vi.stubEnv("MOLTWORLD_EVM_KEY_ROLE", "dedicated");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local EVM EOA auto-payment guard", () => {
  it("refuses by default without the explicit acknowledgement", () => {
    setLocalEnvironment();
    vi.stubEnv("MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY", "");

    expect(() => clientFromEnv()).toThrow(/disabled by default/);
  });

  it("allows an explicitly acknowledged dedicated EOA only in local development", () => {
    setLocalEnvironment();
    vi.stubEnv("MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY", EVM_EOA_AUTOPAY_ACK);
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = clientFromEnv();

    expect(result.robinhood).toBe(true);
    expect(result.client.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/not an owner-authorized on-chain cap or mandate/));
    warning.mockRestore();
  });

  it("selects a deployed WIF mandate signer without enabling unrestricted EOA autopay", () => {
    vi.stubEnv("MOLTWORLD_WIF_MANDATE_ADDRESS", "0x4444444444444444444444444444444444444444");
    vi.stubEnv("MOLTWORLD_WIF_SESSION_PRIVATE_KEY", TEST_KEY);
    vi.stubEnv("MOLTWORLD_EVM_PRIVATE_KEY", "");
    vi.stubEnv("MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY", "");

    const result = clientFromEnv();

    expect(result.robinhood).toBe(true);
    expect(result.mandateBacked).toBe(true);
    expect(result.mandateAddress).toBe("0x4444444444444444444444444444444444444444");
    expect(result.client.address).toBe(result.mandateAddress);
  });

  it("refuses to use a session key as an unrestricted EOA when no mandate is configured", () => {
    vi.stubEnv("MOLTWORLD_WIF_SESSION_PRIVATE_KEY", TEST_KEY);
    vi.stubEnv("MOLTWORLD_WIF_MANDATE_ADDRESS", "");
    vi.stubEnv("MOLTWORLD_EVM_PRIVATE_KEY", "");

    expect(() => clientFromEnv()).toThrow(/requires MOLTWORLD_WIF_MANDATE_ADDRESS/);
  });

  it("refuses in production even when explicitly acknowledged", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOLTWORLD_EVM_PRIVATE_KEY", TEST_KEY);
    vi.stubEnv("MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY", EVM_EOA_AUTOPAY_ACK);

    expect(() => assertEvmEoaAutopayAllowed()).toThrow(/production/);
  });

  it("rejects a key explicitly identified as a master or primary wallet", () => {
    setLocalEnvironment();
    vi.stubEnv("MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY", EVM_EOA_AUTOPAY_ACK);
    vi.stubEnv("MOLTWORLD_EVM_KEY_ROLE", "master");

    expect(() => clientFromEnv()).toThrow(/master\/primary wallet key/);
  });

  it("refuses an EVM key when its dedicated role is not explicitly declared", () => {
    setLocalEnvironment();
    vi.stubEnv("MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY", EVM_EOA_AUTOPAY_ACK);
    vi.stubEnv("MOLTWORLD_EVM_KEY_ROLE", "");

    expect(() => clientFromEnv()).toThrow(/master\/primary wallet key/);
  });
});
