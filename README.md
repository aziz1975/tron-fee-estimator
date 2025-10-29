# TRON Fee Estimator (triggerConstantContract)

A small CLI to **estimate transaction fee (Energy & Bandwidth) in TRX** using **`triggerConstantContract`** on **TronGrid** (no `estimateEnergy` API). The tool does **not broadcast** transactions.

---

## Project Layout

```
tron-fee-estimator/
├─ node_modules/
├─ .env
├─ .env.sample
├─ fee.js
├─ package.json
└─ package-lock.json
```

## Prerequisites

- Node.js 20
- A reachable TRON full node endpoint (default: Nile `https://nile.trongrid.io`)

## Install

```bash
npm i
# or
npm i tronweb dotenv
```

## Configure `.env`

Example (Nile):

```ini
TRON_FULL_NODE=https://nile.trongrid.io
PRIVATE_KEY_NILE=
DEFAULT_USDT=TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
```

> For mainnet, set `TRON_FULL_NODE=https://api.trongrid.io`.

- `DEFAULT_USDT` is just a convenience default for TRC‑20 examples.

## How it works

- Simulates your function with **`triggerconstantcontract`** to get **`energy_used`**.
- Builds a dry‑run tx with **`triggersmartcontract`** to approximate **bandwidth bytes**.
- Converts to TRX using **`getchainparameters`**.

---

## Usage

### A) Generic contract call approve(address,uint256) (energy + bandwidth)

```bash
node fee.js contract-call   --contract <TOKEN_OR_CONTRACT_TADDR>   --selector 'approve(address,uint256)'   --params   '[{"type":"address","value":"<SPENDER_TADDR>"},{"type":"uint256","value":"<RAW_UNITS>"}]'   --from     <CALLER_TADDR>   --callValue 0
```

### B) Generic contract call transfer(address,uint256) (energy + bandwidth)

```bash
node fee.js contract-call   --contract <TOKEN_TADDR>   --selector 'transfer(address,uint256)'   --params   '[{"type":"address","value":"<RECIPIENT_TADDR>"},{"type":"uint256","value":"<RAW_UNITS>"}]'   --from     <OWNER_TADDR>   --callValue 0
```

### C) TRX transfer (bandwidth only)

```bash
node fee.js trx-transfer   --from <SENDER_TADDR>   --to   <RECIPIENT_TADDR>   --amount-trx 1.5
```

### D) TRC‑20 transfer (energy + bandwidth)

```bash
node fee.js trc20-transfer   --token  <TOKEN_TADDR>   --from   <SENDER_TADDR>   --to     <RECIPIENT_TADDR>   --amount <RAW_UNITS>
```

## Example (Nile token used in tests)

Approve 100 units:

```bash
node fee.js contract-call   --contract TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf   --selector 'approve(address,uint256)'   --params   '[{"type":"address","value":"<SPENDER_TADDR>"},{"type":"uint256","value":"100"}]'   --from     <OWNER_TADDR>   --callValue 0
```

Transfer 100 units (owner sends):

```bash
node fee.js contract-call   --contract TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf   --selector 'transfer(address,uint256)'   --params   '[{"type":"address","value":"<RECIPIENT_TADDR>"},{"type":"uint256","value":"100"}]'   --from     <OWNER_TADDR>   --callValue 0
```

TRX transfer:

```bash
node fee.js trx-transfer   --from <SENDER_TADDR>   --to   <RECIPIENT_TADDR>   --amount-trx 1.5
```

TRC‑20 shorthand:

```bash
node fee.js trc20-transfer   --token  TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf   --from   <SENDER_TADDR>   --to     <RECIPIENT_TADDR>   --amount 100
```

---

## Output (example)

```json
{
  "node": "https://nile.trongrid.io",
  "prices": {
    "energySunPerUnit": 100,
    "trxPerEnergy": 0.0001,
    "trxPerByte": 0.001
  },
  "estimate": {
    "kind": "CONTRACT_CALL",
    "energy": 14650,
    "bandwidthBytes": 312,
    "trxEnergy": 1.465,
    "trxBandwidth": 0.312,
    "trxTotal": 1.7770000000000001
  }
}
```

**Notes**

- If `energy` prints **0**, the simulation likely **reverted** (insufficient balance/allowance or token guard).
- Bandwidth is an **approximation** before signatures; good enough for fee planning.

---

## License

TRONDAO
