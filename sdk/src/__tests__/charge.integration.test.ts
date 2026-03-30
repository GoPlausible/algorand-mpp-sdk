/**
 * Integration tests for the Algorand MPP SDK charge method.
 *
 * These tests hit the real Algorand TestNet — they require network access
 * and a funded fee payer account.
 *
 * Configuration via environment variables:
 *   FEE_PAYER_KEY    — 25-word mnemonic or base64 private key
 *   RECIPIENT        — Algorand address to receive payments (defaults to fee payer address)
 *
 * Run: pnpm test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Mppx, Store } from "mppx/server";
import { Challenge, Credential } from "mppx";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { secretKeyToMnemonic } from "@algorandfoundation/algokit-utils/algo25";
import type { TransactionSigner } from "@algorandfoundation/algokit-utils/transact";
import { charge } from "../server/Charge.js";
import {
  ALGORAND_TESTNET,
  DEFAULT_ALGOD_URLS,
} from "../constants.js";
import {
  buildChargeGroup,
  signAndEncodeGroup,
  uint8ArrayToBase64,
  base64ToUint8Array,
  type ClientSigner,
} from "../utils/transactions.js";
import { encodeTransactionRaw } from "@algorandfoundation/algokit-utils/transact";

// ── Test configuration ──

const TESTNET_ALGOD = DEFAULT_ALGOD_URLS[ALGORAND_TESTNET];
const USDC_ASA_ID = 10458941n;
const USDC_DECIMALS = 6;

let feePayerSigner: TransactionSigner;
let feePayerAddress: string;
let recipientAddress: string;

// Evaluate at module level (collection time) so skipIf works correctly.
const hasKey = !!process.env.FEE_PAYER_KEY?.trim();
if (!hasKey) {
  console.warn(
    "Skipping integration tests: FEE_PAYER_KEY not set.\n" +
      "Copy .env-local to .env and set FEE_PAYER_KEY to a funded TestNet mnemonic or base64 private key.",
  );
}

beforeAll(() => {
  if (!hasKey) return;

  const key = process.env.FEE_PAYER_KEY!.trim();
  const algorand = AlgorandClient.testNet();
  const isMnemonic = key.split(/\s+/).length === 25;
  const mnemonic = isMnemonic
    ? key
    : secretKeyToMnemonic(new Uint8Array(Buffer.from(key, "base64")));
  const account = algorand.account.fromMnemonic(mnemonic);

  feePayerSigner = account.signer;
  feePayerAddress = account.addr.toString();
  recipientAddress = process.env.RECIPIENT ?? feePayerAddress;
});

// ── Helpers ──

/** Create an mppx instance with algorand.charge for testing. */
function createMppx(opts: {
  recipient: string;
  asaId?: bigint;
  decimals?: number;
  signer?: TransactionSigner;
  signerAddress?: string;
}) {
  return Mppx.create({
    secretKey: "test-secret-key-for-integration-tests",
    methods: [
      charge({
        recipient: opts.recipient,
        network: ALGORAND_TESTNET,
        algodUrl: TESTNET_ALGOD,
        ...(opts.asaId ? { asaId: opts.asaId, decimals: opts.decimals } : {}),
        ...(opts.signer && opts.signerAddress
          ? {
              signer: opts.signer,
              signerAddress: opts.signerAddress,
            }
          : {}),
      }),
    ],
  });
}

/** Build a signer function that signs with the fee payer key. */
function createTestSigner(): ClientSigner {
  return async (txns: Uint8Array[], indexesToSign?: number[]) => {
    const { decodeTransaction } =
      await import("@algorandfoundation/algokit-utils/transact");
    const results: (Uint8Array | null)[] = txns.map(() => null);
    const indexes = indexesToSign ?? txns.map((_: Uint8Array, i: number) => i);
    for (const idx of indexes) {
      // Decode raw bytes back to Transaction objects for algokit's TransactionSigner.
      const txn = decodeTransaction(txns[idx]);
      const signed = await feePayerSigner([txn], [0]);
      results[idx] = signed[0];
    }
    return results;
  };
}

// ── Tests ──

describe("Server: challenge issuance", () => {
  it.skipIf(!hasKey)("issues a 402 challenge for ALGO payment", async () => {
    const mppx = createMppx({
      recipient: recipientAddress,
      signer: feePayerSigner,
      signerAddress: feePayerAddress,
    });

    const result = await mppx.charge({
      amount: "10000", // 0.01 ALGO
      currency: "ALGO",
      description: "Integration test ALGO",
    })(new Request("https://test.example.com/api/test"));

    expect(result.status).toBe(402);
    const challenge = (result as any).challenge as Response;
    expect(challenge.status).toBe(402);

    const wwwAuth = challenge.headers.get("www-authenticate");
    expect(wwwAuth).toContain("Payment");
    expect(wwwAuth).toContain('method="algorand"');
    expect(wwwAuth).toContain('intent="charge"');
  });

  it.skipIf(!hasKey)("issues a 402 challenge for USDC payment", async () => {
    const mppx = createMppx({
      recipient: recipientAddress,
      asaId: USDC_ASA_ID,
      decimals: USDC_DECIMALS,
      signer: feePayerSigner,
      signerAddress: feePayerAddress,
    });

    const result = await mppx.charge({
      amount: "100000", // 0.10 USDC
      currency: "USDC",
      description: "Integration test USDC",
    })(new Request("https://test.example.com/api/test"));

    expect(result.status).toBe(402);
    const challenge = (result as any).challenge as Response;

    const body = (await challenge.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("challengeId");
  });

  it.skipIf(!hasKey)("challenge includes suggestedParams with minFee", async () => {
    const mppx = createMppx({
      recipient: recipientAddress,
      signer: feePayerSigner,
      signerAddress: feePayerAddress,
    });

    const result = await mppx.charge({
      amount: "10000",
      currency: "ALGO",
    })(new Request("https://test.example.com/api/test"));

    expect(result.status).toBe(402);
    const challenge = (result as any).challenge as Response;
    const wwwAuth = challenge.headers.get("www-authenticate")!;

    // Decode the request parameter from the WWW-Authenticate header
    const requestMatch = wwwAuth.match(/request="([^"]+)"/);
    expect(requestMatch).toBeTruthy();

    const requestData = JSON.parse(
      Buffer.from(requestMatch![1], "base64url").toString(),
    ) as { methodDetails?: { suggestedParams?: Record<string, unknown> } };

    expect(requestData.methodDetails?.suggestedParams).toBeDefined();
    expect(requestData.methodDetails?.suggestedParams).toHaveProperty(
      "firstValid",
    );
    expect(requestData.methodDetails?.suggestedParams).toHaveProperty(
      "lastValid",
    );
    expect(requestData.methodDetails?.suggestedParams).toHaveProperty(
      "genesisHash",
    );
    expect(requestData.methodDetails?.suggestedParams).toHaveProperty(
      "genesisId",
    );
    expect(requestData.methodDetails?.suggestedParams).toHaveProperty(
      "minFee",
    );
    expect(requestData.methodDetails?.suggestedParams).toHaveProperty(
      "fee",
    );
  });

  it.skipIf(!hasKey)(
    "challenge includes challengeReference and lease",
    async () => {
      const mppx = createMppx({
        recipient: recipientAddress,
        signer: feePayerSigner,
        signerAddress: feePayerAddress,
      });

      const result = await mppx.charge({
        amount: "10000",
        currency: "ALGO",
      })(new Request("https://test.example.com/api/test"));

      const challenge = (result as any).challenge as Response;
      const wwwAuth = challenge.headers.get("www-authenticate")!;
      const requestMatch = wwwAuth.match(/request="([^"]+)"/);
      const requestData = JSON.parse(
        Buffer.from(requestMatch![1], "base64url").toString(),
      ) as {
        methodDetails?: {
          challengeReference?: string;
          lease?: string;
          feePayer?: boolean;
          feePayerKey?: string;
        };
      };

      expect(requestData.methodDetails?.challengeReference).toBeDefined();
      expect(requestData.methodDetails?.challengeReference).toMatch(
        /^[0-9a-f-]{36}$/,
      );
      expect(requestData.methodDetails?.lease).toBeDefined();
      // Lease should be base64 (SHA-256 output = 32 bytes → 44 chars in base64)
      expect(requestData.methodDetails?.lease!.length).toBeGreaterThanOrEqual(
        40,
      );
      expect(requestData.methodDetails?.feePayer).toBe(true);
      expect(requestData.methodDetails?.feePayerKey).toBe(feePayerAddress);
    },
  );
});

describe("Server: address validation", () => {
  it("rejects invalid recipient address", () => {
    expect(() =>
      charge({
        recipient: "INVALID_ADDRESS",
        network: ALGORAND_TESTNET,
      }),
    ).toThrow("Invalid recipient address");
  });

  it("rejects invalid fee payer address", () => {
    expect(() =>
      charge({
        recipient: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        network: ALGORAND_TESTNET,
        signerAddress: "INVALID_SIGNER",
        signer: (async () => []) as unknown as TransactionSigner,
      }),
    ).toThrow("Invalid fee payer");
  });

  it("rejects asaId without decimals", () => {
    expect(() =>
      charge({
        recipient: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        network: ALGORAND_TESTNET,
        asaId: 31566704n,
      }),
    ).toThrow("decimals is required");
  });
});

describe("Client: transaction building", () => {
  it.skipIf(!hasKey)("builds ALGO charge group with fee payer", () => {
    const result = buildChargeGroup({
      sender: feePayerAddress,
      receiver: recipientAddress,
      amount: 10000n,
      challengeReference: "test-ref",
      useServerFeePayer: true,
      feePayerKey: feePayerAddress,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        fee: 0n,
        minFee: 1000n,
      },
    });

    expect(result.transactions.length).toBe(2);
    expect(result.paymentIndex).toBe(1);
    // Fee payer at index 0
    expect(result.transactions[0].payment?.amount).toBe(0n);
    // Payment has correct amount
    expect(result.transactions[1].payment?.amount).toBe(10000n);
    // All grouped
    expect(result.transactions[0].group).toBeDefined();
    expect(result.transactions[0].group).toEqual(result.transactions[1].group);
  });

  it.skipIf(!hasKey)("builds charge group with lease", () => {
    const lease = new Uint8Array(32);
    lease.fill(0xab);

    const result = buildChargeGroup({
      sender: feePayerAddress,
      receiver: recipientAddress,
      amount: 10000n,
      challengeReference: "test-ref-lease",
      lease,
      useServerFeePayer: true,
      feePayerKey: feePayerAddress,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        fee: 0n,
        minFee: 1000n,
      },
    });

    expect(result.transactions.length).toBe(2);
    // Payment transaction (index 1) should have lease
    expect(result.transactions[result.paymentIndex].lease).toBeDefined();
    expect(result.transactions[result.paymentIndex].lease![0]).toBe(0xab);
    // Fee payer transaction (index 0) should NOT have lease
    expect(result.transactions[0].lease).toBeUndefined();
  });
});

describe("Encoding: transaction roundtrip", () => {
  it.skipIf(!hasKey)(
    "encodeTransactionRaw roundtrip preserves group ID and sender",
    async () => {
      const { decodeTransaction } =
        await import("@algorandfoundation/algokit-utils/transact");

      const result = buildChargeGroup({
        sender: feePayerAddress,
        receiver: recipientAddress,
        amount: 10000n,
        challengeReference: "encode-test",
        useServerFeePayer: true,
        feePayerKey: feePayerAddress,
        suggestedParams: {
          firstValid: 100n,
          lastValid: 1100n,
          genesisHash: new Uint8Array(32),
          genesisId: "testnet-v1.0",
          fee: 0n,
        minFee: 1000n,
        },
      });

      for (const txn of result.transactions) {
        const encoded = encodeTransactionRaw(txn);
        const decoded = decodeTransaction(encoded);

        expect(decoded.sender.toString()).toBe(txn.sender.toString());
        expect(decoded.group).toBeDefined();
        expect(decoded.group).toEqual(txn.group);
      }
    },
  );

  it("base64 roundtrip", () => {
    const original = new Uint8Array([0, 1, 2, 3, 255, 128, 64, 32]);
    const encoded = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("End-to-end: full ALGO payment flow (TestNet)", () => {
  it.skipIf(!hasKey)(
    "completes a self-payment via server-broadcast mode",
    async () => {
      // This test sends 0.01 ALGO from the fee payer to itself.
      // It exercises the full 402 → build → sign → credential → verify → receipt flow.

      const store = Store.memory();
      const mppx = Mppx.create({
        secretKey: "e2e-test-secret",
        methods: [
          charge({
            recipient: feePayerAddress, // Pay to self for testing
            network: ALGORAND_TESTNET,
            algodUrl: TESTNET_ALGOD,
                signer: feePayerSigner,
            signerAddress: feePayerAddress,
            store,
          }),
        ],
      });

      // Step 1: Get 402 challenge
      const req1 = new Request("https://test.example.com/api/paid");
      const result1 = await mppx.charge({
        amount: "10000",
        currency: "ALGO",
        description: "E2E test",
      })(req1);

      expect(result1.status).toBe(402);
      const challengeResponse = (result1 as any).challenge as Response;
      const wwwAuth = challengeResponse.headers.get("www-authenticate")!;

      // Step 2: Parse challenge using mppx
      const challenge = Challenge.deserialize(wwwAuth);
      const challengeRequest = challenge.request as {
        amount: string;
        methodDetails: {
          suggestedParams: {
            fee: number;
            firstValid: number;
            lastValid: number;
            genesisHash: string;
            genesisId: string;
            minFee: number;
          };
          feePayer: boolean;
          feePayerKey: string;
          challengeReference: string;
          lease?: string;
        };
        recipient: string;
      };

      // Step 3: Build transaction group
      const sp = challengeRequest.methodDetails.suggestedParams;
      const lease = challengeRequest.methodDetails.lease
        ? base64ToUint8Array(challengeRequest.methodDetails.lease)
        : undefined;

      const group = buildChargeGroup({
        sender: feePayerAddress,
        receiver: challengeRequest.recipient,
        amount: BigInt(challengeRequest.amount),
        challengeReference: challengeRequest.methodDetails.challengeReference,
        lease,
        useServerFeePayer: challengeRequest.methodDetails.feePayer,
        feePayerKey: challengeRequest.methodDetails.feePayerKey,
        suggestedParams: {
          fee: BigInt(sp.fee),
          firstValid: BigInt(sp.firstValid),
          lastValid: BigInt(sp.lastValid),
          genesisHash: base64ToUint8Array(sp.genesisHash),
          genesisId: sp.genesisId,
          minFee: BigInt(sp.minFee),
        },
      });

      // Step 4: Sign (client signs all except fee payer at index 0)
      const feePayerIdx = group.transactions.findIndex(
        (txn) => txn.payment?.amount === 0n,
      );
      const encoded = await signAndEncodeGroup({
        transactions: group.transactions,
        signer: createTestSigner(),
        feePayerIndex: feePayerIdx >= 0 ? feePayerIdx : undefined,
      });

      // Step 5: Build credential using mppx's Credential.serialize and retry
      const authHeader = Credential.serialize({
        challenge,
        payload: {
          type: "transaction",
          paymentGroup: encoded,
          paymentIndex: group.paymentIndex,
        },
      });

      const req2 = new Request("https://test.example.com/api/paid", {
        headers: {
          Authorization: authHeader,
        },
      });

      const result2 = await mppx.charge({
        amount: "10000",
        currency: "ALGO",
        description: "E2E test",
      })(req2);

      // Step 6: Verify success
      expect(result2.status).toBe(200);

      const successResponse = (
        result2 as { status: 200; withReceipt: (r: Response) => Response }
      ).withReceipt(Response.json({ data: "test" }));

      expect(successResponse.status).toBe(200);

      // Check receipt header
      const receiptHeader = successResponse.headers.get("payment-receipt");
      expect(receiptHeader).toBeTruthy();

      const receipt = JSON.parse(
        Buffer.from(receiptHeader!, "base64url").toString(),
      ) as {
        method: string;
        reference: string;
        status: string;
        timestamp: string;
      };

      expect(receipt.method).toBe("algorand");
      expect(receipt.status).toBe("success");
      expect(receipt.reference).toMatch(/^[A-Z2-7]{52}$/); // Valid TxID
      expect(receipt.timestamp).toBeTruthy();

      console.log(`  E2E payment confirmed: ${receipt.reference}`);
      console.log(
        `  https://lora.algokit.io/testnet/transaction/${receipt.reference}`,
      );
    },
    60_000,
  );
});
