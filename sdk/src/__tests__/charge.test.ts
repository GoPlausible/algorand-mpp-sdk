import { describe, it, expect } from "vitest";

import { charge } from "../Methods.js";
import {
  ALGORAND_MAINNET,
  ALGORAND_TESTNET,
  DEFAULT_MIN_FEE,
  DEFAULT_ALGOD_URLS,
  DEFAULT_INDEXER_URLS,
} from "../constants.js";

const defaultParams = {
  fee: 0n,
  firstValid: 100n,
  lastValid: 1100n,
  genesisHash: new Uint8Array(32),
  genesisId: "testnet-v1.0",
  minFee: 1000n,
};

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

describe("computeRequiredFee", () => {
  it("returns minFee when feePerByte is 0 (normal conditions)", async () => {
    const { computeRequiredFee } = await import("../utils/transactions.js");
    // max(0 * 200, 1000) = 1000
    expect(computeRequiredFee(0n, 200n, 1000n)).toBe(1000n);
  });

  it("returns size-based fee when it exceeds minFee (congestion)", async () => {
    const { computeRequiredFee } = await import("../utils/transactions.js");
    // max(10 * 200, 1000) = 2000
    expect(computeRequiredFee(10n, 200n, 1000n)).toBe(2000n);
  });

  it("returns minFee when size-based fee equals minFee", async () => {
    const { computeRequiredFee } = await import("../utils/transactions.js");
    // max(5 * 200, 1000) = 1000
    expect(computeRequiredFee(5n, 200n, 1000n)).toBe(1000n);
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
      suggestedParams: defaultParams,
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
      suggestedParams: defaultParams,
    });

    expect(txn.type).toBe(TransactionType.AssetTransfer);
    expect(txn.assetTransfer?.amount).toBe(1_000_000n);
    expect(txn.assetTransfer?.assetId).toBe(31566704n);
  });

  it("builds a fee payer transaction with explicit pooled fee", async () => {
    const { buildFeePayerTransaction } =
      await import("../utils/transactions.js");
    const { TransactionType } =
      await import("@algorandfoundation/algokit-utils/transact");

    const feePayerKey =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const txn = buildFeePayerTransaction({
      feePayerKey,
      pooledFee: 2000n,
      suggestedParams: defaultParams,
    });

    expect(txn.type).toBe(TransactionType.Payment);
    expect(txn.payment?.amount).toBe(0n);
    expect(txn.fee).toBe(2000n);
  });

  it("charge group fee payer covers pooled fees using formula", async () => {
    const { buildChargeGroup, computeRequiredFee } =
      await import("../utils/transactions.js");
    const { encodeTransactionRaw } =
      await import("@algorandfoundation/algokit-utils/transact");

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
      suggestedParams: defaultParams,
    });

    expect(paymentIndex).toBe(1);
    expect(transactions.length).toBe(2);

    // Fee payer (idx 0) carries pooled fee; payment (idx 1) has fee=0.
    expect(transactions[1].fee).toBe(0n);
    const feePayerFee = transactions[0].fee!;

    // Verify the pooled fee covers both txns using the spec formula.
    let expectedPooled = 0n;
    for (const txn of transactions) {
      const size = BigInt(encodeTransactionRaw(txn).length);
      expectedPooled += computeRequiredFee(
        defaultParams.fee,
        size,
        defaultParams.minFee,
      );
    }
    expect(feePayerFee).toBe(expectedPooled);
    // Under normal conditions (fee=0), this is >= N * minFee
    expect(feePayerFee).toBeGreaterThanOrEqual(2n * defaultParams.minFee);
  });

  it("client-paid fee uses formula (not just minFee)", async () => {
    const { buildChargeGroup, computeRequiredFee } =
      await import("../utils/transactions.js");
    const { encodeTransactionRaw } =
      await import("@algorandfoundation/algokit-utils/transact");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const { transactions, paymentIndex } = buildChargeGroup({
      sender,
      receiver,
      amount: 1_000_000n,
      challengeReference: "test-ref-client-fee",
      useServerFeePayer: false,
      suggestedParams: defaultParams,
    });

    expect(transactions.length).toBe(1);
    const txn = transactions[paymentIndex];
    const size = BigInt(encodeTransactionRaw(txn).length);
    const expectedFee = computeRequiredFee(
      defaultParams.fee,
      size,
      defaultParams.minFee,
    );
    expect(txn.fee).toBe(expectedFee);
  });

  it("congestion fee (feePerByte > 0) produces higher fees", async () => {
    const { buildChargeGroup, computeRequiredFee } =
      await import("../utils/transactions.js");
    const { encodeTransactionRaw } =
      await import("@algorandfoundation/algokit-utils/transact");

    const sender = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const receiver =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

    const congestedParams = { ...defaultParams, fee: 100n }; // 100 microalgos per byte (heavy congestion)

    const { transactions: normalTxns } = buildChargeGroup({
      sender,
      receiver,
      amount: 1_000_000n,
      challengeReference: "test-normal",
      useServerFeePayer: false,
      suggestedParams: defaultParams,
    });

    const { transactions: congestedTxns } = buildChargeGroup({
      sender,
      receiver,
      amount: 1_000_000n,
      challengeReference: "test-congested",
      useServerFeePayer: false,
      suggestedParams: congestedParams,
    });

    // Congested fee should be higher than normal fee
    expect(congestedTxns[0].fee!).toBeGreaterThan(normalTxns[0].fee!);
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
      suggestedParams: defaultParams,
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
      suggestedParams: defaultParams,
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
