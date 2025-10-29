#!/usr/bin/env node
require('dotenv').config();
const {TronWeb} = require('tronweb');

// ===== env / config =====
const privateKey   = process.env.PRIVATE_KEY_NILE;
const fullHost = process.env.TRON_FULL_NODE || 'https://nile.trongrid.io';
const DEFAULT_USDT_T = process.env.DEFAULT_USDT || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'; // Base58

// ========================

function makeTronWeb() {
  return new TronWeb({
  fullHost,
  privateKey
});

}

const sunToTRX = s => s / 1e6;
const isT = a => typeof a === 'string' && a.startsWith('T');
const toHexAddr = (tw, a) => isT(a) ? tw.address.toHex(a) : a;

function assertAddress(tw, a, label) {
  const ok = (typeof a === 'string') && (tw.isAddress(a) || /^41[0-9a-fA-F]{40}$/.test(a));
  if (!ok) throw new Error(`Invalid ${label} address: ${a} (expect T-address or 41.. hex)`);
}

function normalizeTrxPerByte(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error('Bad getTransactionFee value');
  // Some nodes return sun/byte (>=1), some TRX/byte (<1). Normalize to TRX/byte.
  return v >= 1 ? v / 1e6 : v;
}

async function getChainPrices(tronWeb) {
  const params = await tronWeb.trx.getChainParameters();
  const e = params.find(p => p.key === 'getEnergyFee');       // sun per Energy
  const b = params.find(p => p.key === 'getTransactionFee');  // TRX/byte OR sun/byte
  if (!e || !b) throw new Error('Missing chain params getEnergyFee/getTransactionFee');
  const energySunPerUnit = Number(e.value);          // e.g., 100 sun/Energy
  const trxPerEnergy     = sunToTRX(energySunPerUnit);
  const trxPerByte       = normalizeTrxPerByte(b.value);
  return { energySunPerUnit, trxPerEnergy, trxPerByte };
}

const calcEnergyTRX = (energy, trxPerEnergy) => energy * trxPerEnergy;
const calcBandwidthTRX = (bytes, trxPerByte) => bytes * trxPerByte;

function approxTxBytes(wrapper) {
  const hex = wrapper?.raw_data_hex || wrapper?.transaction?.raw_data_hex;
  return hex ? Math.round(hex.length / 2 + 100) : 270; // add ~100B for sig/wrapper
}

function normalizeParams(tw, params) {
  if (!Array.isArray(params)) return [];
  return params.map(p => {
    if (!p || typeof p !== 'object') return p;
    if (p.type === 'address' && typeof p.value === 'string')
      return { ...p, value: toHexAddr(tw, p.value) };
    if (p.type === 'address[]' && Array.isArray(p.value))
      return { ...p, value: p.value.map(v => (typeof v === 'string' ? toHexAddr(tw, v) : v)) };
    return p;
  });
}

async function safeTriggerConstantEnergy(tw, { contractHex, selector, params, issuerBase58, callValueSun = 0 }) {
  try {
    const r = await tw.transactionBuilder.triggerConstantContract(
      contractHex, selector, { from: issuerBase58, callValue: callValueSun, feeLimit: 1_000_000_000 }, params
    );
    const used = r.energy_used ?? r.energy_used_total ?? 0;
    return typeof used === 'number' ? used : null;
  } catch (_) {
    return null;
  }
}

// ---- estimators ----
async function estimateTrxTransfer(tw, { fromT, toT, amountTrx }, prices) {
  assertAddress(tw, fromT, 'from');
  assertAddress(tw, toT, 'to');

  const fromHex = tw.address.toHex(fromT); // sendTrx needs owner in hex
  const tx = await tw.transactionBuilder.sendTrx(toT, tw.toSun(amountTrx), fromHex);
  const bytes = approxTxBytes(tx);
  const trxBandwidth = calcBandwidthTRX(bytes, prices.trxPerByte);
  return { kind: 'TRX_TRANSFER', energy: 0, bandwidthBytes: bytes, trxEnergy: 0, trxBandwidth, trxTotal: trxBandwidth };
}

async function estimateTrc20Transfer(tw, { tokenT, fromT, toT, amount }, prices) {
  assertAddress(tw, tokenT, 'token');
  assertAddress(tw, fromT,  'from');
  assertAddress(tw, toT,    'to');

  const tokenHex = toHexAddr(tw, tokenT);
  const fromHex  = tw.address.toHex(fromT);
  const toHex    = tw.address.toHex(toT);
  const selector = 'transfer(address,uint256)';
  const params   = [{ type: 'address', value: toHex }, { type: 'uint256', value: String(amount) }];

    energy = await safeTriggerConstantEnergy(tw, {
      contractHex: tokenHex, selector, params, issuerBase58: fromT
    });

  if (energy == null) energy = 0;

  // Build tx (issuer Base58 + feeLimit) for bandwidth bytes
  const trigger = await tw.transactionBuilder.triggerSmartContract(
    tokenHex, selector, { callValue: 0, feeLimit: 1_000_000_000 }, params, fromT
  );
  const bytes = approxTxBytes(trigger.transaction);

  const trxEnergy    = calcEnergyTRX(energy, prices.trxPerEnergy);
  const trxBandwidth = calcBandwidthTRX(bytes,  prices.trxPerByte);
  return { kind: 'TRC20_TRANSFER', energy, bandwidthBytes: bytes, trxEnergy, trxBandwidth, trxTotal: trxEnergy + trxBandwidth };
}

async function estimateContractCall(tw, { contractT, fromT, selector, paramsJson, callValueTrx }, prices) {
  assertAddress(tw, contractT, 'contract');
  assertAddress(tw, fromT,     'from');

  const contractHex = toHexAddr(tw, contractT);
  const fromHex     = tw.address.toHex(fromT);
  const callValue   = Number(callValueTrx || 0);
  const callValueSun = tw.toSun(callValue);

  let params = [];
  if (paramsJson) params = JSON.parse(paramsJson);
  params = normalizeParams(tw, params);

    energy = await safeTriggerConstantEnergy(tw, {
      contractHex, selector, params, issuerBase58: fromT, callValueSun
    });

  if (energy == null) energy = 0;

  const trigger = await tw.transactionBuilder.triggerSmartContract(
    contractHex, selector, { callValue: callValueSun, feeLimit: 1_000_000_000 }, params, fromT
  );
  const bytes = approxTxBytes(trigger.transaction);

  const trxEnergy    = calcEnergyTRX(energy, prices.trxPerEnergy);
  const trxBandwidth = calcBandwidthTRX(bytes,  prices.trxPerByte);
  return { kind: 'CONTRACT_CALL', energy, bandwidthBytes: bytes, trxEnergy, trxBandwidth, trxTotal: trxEnergy + trxBandwidth };
}

// ---- tiny arg parser ----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

// ---- main ----
(async function main() {
  const [,, cmd, ...rest] = process.argv;
  if (!cmd || ['-h','--help','help'].includes(cmd)) {
    console.log(`
TRON Fee Estimator (TRONGRID-ready; uses .env; Base58 USDT)

ENV (.env):
  TRON_FULL_NODE=${fullHost}
  PRIVATE_KEY=${privateKey ? '<set>' : ''}
  DEFAULT_USDT=${DEFAULT_USDT_T}

USAGE:
  node fee.js trx-transfer --from T... --to T... --amount-trx 1.5

  node fee.js trc20-transfer --from T... --to T... --amount 1000000 [--token ${DEFAULT_USDT_T}]

  node fee.js contract-call --contract T... --selector 'approve(address,uint256)' \\
    --params '[{"type":"address","value":"T..."},{"type":"uint256","value":"1000000"}]' \\
    --from T... --callValue 0
`); return;
  }

  const tw = makeTronWeb();

  // Portable connectivity check
  try {
    if (typeof tw.trx.getCurrentBlock === 'function') {
      await tw.trx.getCurrentBlock();
    } else {
      await tw.fullNode.request('wallet/getnowblock', 'post', {});
    }
  } catch (e) {

    throw e;
  }

  const prices = await getChainPrices(tw);
  const args = parseArgs(rest);

  let result;
  if (cmd === 'trx-transfer') {
    if (!args.from || !args.to || !args['amount-trx']) throw new Error('Missing --from --to --amount-trx');
    result = await estimateTrxTransfer(tw, { fromT: args.from, toT: args.to, amountTrx: Number(args['amount-trx']) }, prices);

  } else if (cmd === 'trc20-transfer') {
    if (!args.from || !args.to || !args.amount) throw new Error('Missing --from --to --amount');
    const tokenT = args.token || DEFAULT_USDT_T; // Base58
    result = await estimateTrc20Transfer(tw, { tokenT, fromT: args.from, toT: args.to, amount: String(args.amount) }, prices);

  } else if (cmd === 'contract-call') {
    if (!args.contract || !args.selector || !args.from) throw new Error('Missing --contract --selector --from');
    result = await estimateContractCall(tw, {
      contractT: args.contract,
      fromT: args.from,
      selector: args.selector,
      paramsJson: args.params || '[]',
      callValueTrx: Number(args.callValue || 0)
    }, prices);

  } else {
    throw new Error(`Unknown command: ${cmd}`);
  }

  console.log(JSON.stringify({
    node: fullHost,
    prices: {
      energySunPerUnit: prices.energySunPerUnit,
      trxPerEnergy: prices.trxPerEnergy,
      trxPerByte: prices.trxPerByte
    },
    estimate: result
  }, null, 2));
})().catch(e => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
