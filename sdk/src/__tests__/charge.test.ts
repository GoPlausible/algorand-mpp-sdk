import { describe, it, expect } from "vitest";

import { charge } from "../Methods.js";
import {
  ALGORAND_MAINNET,
  ALGORAND_TESTNET,
  DEFAULT_MIN_FEE,
  DEFAULT_ALGOD_URLS,
  DEFAULT_INDEXER_URLS,
} from "../constants.js";

describe("charge method schema", () => {
  it("has the correct intent and name", () => {
    expect(charge.intent).toBe("charge");
    expect(charge.name).toBe("algorand");
  });
});

describe("constants", () => {
  it("has correct CAIP-2 network identifiers", () => {
    expect(ALGORAND_MAINNET).toMatch(/^algorand:/);
    expect(ALGORAND_TESTNET).toMatch(/^algorand:/);
    expect(ALGORAND_MAINNET).not.toBe(ALGORAND_TESTNET);
  });

  it("has correct default minimum fee", () => {
    expect(DEFAULT_MIN_FEE).toBe(1000n);
  });

  it("has default algod URLs for known networks", () => {
    expect(DEFAULT_ALGOD_URLS[ALGORAND_MAINNET]).toBeDefined();
    expect(DEFAULT_ALGOD_URLS[ALGORAND_TESTNET]).toBeDefined();
  });

  it("has default indexer URLs for known networks", () => {
    expect(DEFAULT_INDEXER_URLS[ALGORAND_MAINNET]).toBeDefined();
    expect(DEFAULT_INDEXER_URLS[ALGORAND_TESTNET]).toBeDefined();
  });
});

describe("transaction utilities", () => {
  it("builds a native ALGO payment transaction", async () => {
    const { buildPaymentTransaction } =
      await import("../utils/transactions.js");
    const { TransactionType } =
      await import("@algorandfoundation/algokit-utils/transact");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const txn = buildPaymentTransaction({
      sender,
      receiver,
      amount: 1_000_000n,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 1000n,
      },
    });

    expect(txn.type).toBe(TransactionType.Payment);
    expect(txn.payment?.amount).toBe(1_000_000n);
    expect(txn.firstValid).toBe(100n);
    expect(txn.lastValid).toBe(1100n);
  });

  it("builds an ASA transfer transaction", async () => {
    const { buildPaymentTransaction } =
      await import("../utils/transactions.js");
    const { TransactionType } =
      await import("@algorandfoundation/algokit-utils/transact");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const txn = buildPaymentTransaction({
      sender,
      receiver,
      amount: 1_000_000n,
      asaId: 31566704n,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 1000n,
      },
    });

    expect(txn.type).toBe(TransactionType.AssetTransfer);
    expect(txn.assetTransfer?.amount).toBe(1_000_000n);
    expect(txn.assetTransfer?.assetId).toBe(31566704n);
  });

  it("builds a fee payer transaction with dynamic minFee", async () => {
    const { buildFeePayerTransaction } =
      await import("../utils/transactions.js");
    const { TransactionType } =
      await import("@algorandfoundation/algokit-utils/transact");

    const feePayerKey =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const txn = buildFeePayerTransaction({
      feePayerKey,
      groupSize: 2,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 1000n,
      },
    });

    expect(txn.type).toBe(TransactionType.Payment);
    expect(txn.payment?.amount).toBe(0n);
    // Fee should cover 2 transactions: 2 * 1000 = 2000
    expect(txn.fee).toBe(2000n);
  });

  it("fee payer uses dynamic minFee (not hardcoded)", async () => {
    const { buildFeePayerTransaction } =
      await import("../utils/transactions.js");

    const feePayerKey =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const txn = buildFeePayerTransaction({
      feePayerKey,
      groupSize: 2,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 2000n, // Higher minFee (congestion)
      },
    });

    // Fee should be 2 * 2000 = 4000
    expect(txn.fee).toBe(4000n);
  });

  it("builds a charge group with fee payer", async () => {
    const { buildChargeGroup } = await import("../utils/transactions.js");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const feePayerKey =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const { transactions, paymentIndex } = buildChargeGroup({
      sender,
      receiver,
      amount: 1_000_000n,
      challengeReference: "test-ref-456",
      useServerFeePayer: true,
      feePayerKey,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 1000n,
      },
    });

    // Fee payer at index 0, payment at index 1.
    expect(paymentIndex).toBe(1);
    expect(transactions.length).toBe(2);
    expect(transactions[0].payment?.amount).toBe(0n); // Fee payer: zero amount.
    expect(transactions[1].payment?.amount).toBe(1_000_000n); // Primary payment.
  });

  it("builds a charge group with lease", async () => {
    const { buildChargeGroup } = await import("../utils/transactions.js");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const lease = new Uint8Array(32);
    lease[0] = 0x42;

    const { transactions, paymentIndex } = buildChargeGroup({
      sender,
      receiver,
      amount: 1_000_000n,
      challengeReference: "test-ref-lease",
      lease,
      useServerFeePayer: false,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 1000n,
      },
    });

    expect(paymentIndex).toBe(0);
    expect(transactions.length).toBe(1);
    expect(transactions[0].lease).toBeDefined();
    expect(transactions[0].lease![0]).toBe(0x42);
  });

  it("charge group note includes challengeReference", async () => {
    const { buildChargeGroup } = await import("../utils/transactions.js");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const { transactions, paymentIndex } = buildChargeGroup({
      sender,
      receiver,
      amount: 1_000_000n,
      challengeReference: "my-challenge-ref",
      useServerFeePayer: false,
      suggestedParams: {
        firstValid: 100n,
        lastValid: 1100n,
        genesisHash: new Uint8Array(32),
        genesisId: "testnet-v1.0",
        minFee: 1000n,
      },
    });

    const note = new TextDecoder().decode(transactions[paymentIndex].note);
    expect(note).toBe("mppx:my-challenge-ref");
  });

  it("base64 encode/decode roundtrip", async () => {
    const { uint8ArrayToBase64, base64ToUint8Array } =
      await import("../utils/transactions.js");
    const original = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
    const encoded = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(encoded);
    expect(decoded).toEqual(original);
  });
});
