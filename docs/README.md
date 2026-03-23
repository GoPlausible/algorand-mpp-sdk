# Algorand MPP SDK Documentation

**Machine Payments Protocol (MPP) SDK for Algorand**

The Algorand MPP SDK implements the Machine Payments Protocol for the Algorand blockchain, enabling HTTP-native micropayments using the `402 Payment Required` status code. It allows any HTTP API to charge for access using native ALGO or Algorand Standard Assets (ASAs) like USDC.

Built on [`@algorandfoundation/algokit-utils`](https://github.com/algorandfoundation/algokit-utils-ts) (no algosdk dependency) and the [`mppx`](https://www.npmjs.com/package/mppx) protocol library.

---

## Table of Contents

| Document | Description |
|----------|-------------|
| [What is MPP?](./mpp-overview.md) | Overview of the Machine Payments Protocol |
| [Algorand Charge Spec](./spec.md) | The Algorand-specific charge method specification |
| [Architecture](./architecture.md) | SDK architecture, modules, and design decisions |
| [Payment Flows](./payment-flows.md) | Pull mode, push mode, fee sponsorship, and splits |
| [Demo Guide](./demo.md) | Demo application features, scenarios, and setup |
| [Demo README](../demo/README.md) | Demo quick start, configuration, and API reference |
| [Full Specification](../specs/draft-algorand-charge-00.md) | Complete IETF-style specification document |

---

## Quick Links

- [GitHub Repository](https://github.com/GoPlausible/algorand-mpp-sdk-sdk)
- [MPP Specification](https://paymentauth.org)
- [Algorand Developer Docs](https://dev.algorand.co)
- [GoPlausible](https://goplausible.com)
