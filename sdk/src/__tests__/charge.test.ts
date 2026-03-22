import { describe, it, expect } from 'vitest';

import { charge } from '../Methods.js';
import {
    ALGORAND_MAINNET,
    ALGORAND_TESTNET,
    MIN_TXN_FEE,
    DEFAULT_ALGOD_URLS,
    DEFAULT_INDEXER_URLS,
} from '../constants.js';

describe('charge method schema', () => {
    it('has the correct intent and name', () => {
        expect(charge.intent).toBe('charge');
        expect(charge.name).toBe('algorand');
    });
});

describe('constants', () => {
    it('has correct CAIP-2 network identifiers', () => {
        expect(ALGORAND_MAINNET).toMatch(/^algorand:/);
        expect(ALGORAND_TESTNET).toMatch(/^algorand:/);
        expect(ALGORAND_MAINNET).not.toBe(ALGORAND_TESTNET);
    });

    it('has correct minimum transaction fee', () => {
        expect(MIN_TXN_FEE).toBe(1000n);
    });

    it('has default algod URLs for known networks', () => {
        expect(DEFAULT_ALGOD_URLS[ALGORAND_MAINNET]).toBeDefined();
        expect(DEFAULT_ALGOD_URLS[ALGORAND_TESTNET]).toBeDefined();
    });

    it('has default indexer URLs for known networks', () => {
        expect(DEFAULT_INDEXER_URLS[ALGORAND_MAINNET]).toBeDefined();
        expect(DEFAULT_INDEXER_URLS[ALGORAND_TESTNET]).toBeDefined();
    });
});

describe('transaction utilities', () => {
    it('builds a native ALGO payment transaction', async () => {
        const { buildPaymentTransaction } = await import('../utils/transactions.js');
        const { Address } = await import('@algorandfoundation/algokit-utils');
        const { TransactionType } = await import('@algorandfoundation/algokit-utils/transact');

        // Use zero address as placeholder.
        const sender = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
        const receiver = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

        const txn = buildPaymentTransaction({
            sender,
            receiver,
            amount: 1_000_000n,
            suggestedParams: {
                firstValid: 100n,
                lastValid: 1100n,
                genesisHash: new Uint8Array(32),
                genesisId: 'testnet-v1.0',
            },
        });

        expect(txn.type).toBe(TransactionType.Payment);
        expect(txn.payment?.amount).toBe(1_000_000n);
        expect(txn.firstValid).toBe(100n);
        expect(txn.lastValid).toBe(1100n);
    });

    it('builds an ASA transfer transaction', async () => {
        const { buildPaymentTransaction } = await import('../utils/transactions.js');
        const { TransactionType } = await import('@algorandfoundation/algokit-utils/transact');

        const sender = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
        const receiver = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

        const txn = buildPaymentTransaction({
            sender,
            receiver,
            amount: 1_000_000n,
            asaId: 31566704n,
            suggestedParams: {
                firstValid: 100n,
                lastValid: 1100n,
                genesisHash: new Uint8Array(32),
                genesisId: 'testnet-v1.0',
            },
        });

        expect(txn.type).toBe(TransactionType.AssetTransfer);
        expect(txn.assetTransfer?.amount).toBe(1_000_000n);
        expect(txn.assetTransfer?.assetId).toBe(31566704n);
    });

    it('builds a fee payer transaction', async () => {
        const { buildFeePayerTransaction } = await import('../utils/transactions.js');
        const { TransactionType } = await import('@algorandfoundation/algokit-utils/transact');

        const feePayerKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

        const txn = buildFeePayerTransaction({
            feePayerKey,
            groupSize: 3,
            suggestedParams: {
                firstValid: 100n,
                lastValid: 1100n,
                genesisHash: new Uint8Array(32),
                genesisId: 'testnet-v1.0',
            },
        });

        expect(txn.type).toBe(TransactionType.Payment);
        expect(txn.payment?.amount).toBe(0n);
        // Fee should cover all 3 transactions: 3 * 1000 = 3000
        expect(txn.fee).toBe(3000n);
    });

    it('builds a charge group with splits', async () => {
        const { buildChargeGroup } = await import('../utils/transactions.js');

        const sender = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
        const receiver = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

        const { transactions, paymentIndex } = buildChargeGroup({
            sender,
            receiver,
            amount: 1_050_000n,
            reference: 'test-ref-123',
            splits: [{ recipient: receiver, amount: '50000' }],
            useServerFeePayer: false,
            suggestedParams: {
                firstValid: 100n,
                lastValid: 1100n,
                genesisHash: new Uint8Array(32),
                genesisId: 'testnet-v1.0',
            },
        });

        expect(paymentIndex).toBe(0);
        expect(transactions.length).toBe(2); // primary + 1 split
        // All should have same group ID.
        expect(transactions[0].group).toBeDefined();
        expect(transactions[1].group).toBeDefined();
        expect(transactions[0].group).toEqual(transactions[1].group);
    });

    it('builds a charge group with fee payer', async () => {
        const { buildChargeGroup } = await import('../utils/transactions.js');

        const sender = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
        const receiver = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
        const feePayerKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

        const { transactions, paymentIndex } = buildChargeGroup({
            sender,
            receiver,
            amount: 1_000_000n,
            reference: 'test-ref-456',
            useServerFeePayer: true,
            feePayerKey,
            suggestedParams: {
                firstValid: 100n,
                lastValid: 1100n,
                genesisHash: new Uint8Array(32),
                genesisId: 'testnet-v1.0',
            },
        });

        // Fee payer at index 0, payment at index 1.
        expect(paymentIndex).toBe(1);
        expect(transactions.length).toBe(2);
        expect(transactions[0].payment?.amount).toBe(0n); // Fee payer: zero amount.
        expect(transactions[1].payment?.amount).toBe(1_000_000n); // Primary payment.
    });

    it('base64 encode/decode roundtrip', async () => {
        const { uint8ArrayToBase64, base64ToUint8Array } = await import('../utils/transactions.js');
        const original = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
        const encoded = uint8ArrayToBase64(original);
        const decoded = base64ToUint8Array(encoded);
        expect(decoded).toEqual(original);
    });
});
