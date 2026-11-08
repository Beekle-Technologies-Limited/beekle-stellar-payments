import { escapeHtml } from '../api/present';
import type { ReceivingAssessment } from '../stellar/readiness';

export type CheckoutPageModel = {
  id: string;
  status: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  network: string;
  destination: string;
  memo: string;
  memoType: string;
  expiresAt: string;
  sep7: string | null;
  providerReference: string | null;
  receivedAmount: string;
  passphrase: string;
  readiness: ReceivingAssessment;
};

const STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'Waiting for the customer wallet',
  PARTIAL: 'Partial payment held for review',
  OVERPAID: 'Overpayment held for review',
  HELD: 'Late payment held for review',
  CREDITED: 'Paid',
  COMPLETED: 'Paid',
  EXPIRED: 'Expired before payment',
};

export function renderHomePage(input: {
  network: string;
  assetLabel: string;
  openRegistration: boolean;
  usdcConfigured: boolean;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beekle checkout demo</title>
  ${styles()}
</head>
<body>
  <header class="top">
    <div class="brand">Beekle <span>Stellar</span></div>
    <div class="pill">${escapeHtml(input.network.toUpperCase())}</div>
  </header>
  <main class="wrap">
    <p class="eyebrow">Direct native checkout · not a production deployment</p>
    <h1>Request a Stellar payment without taking the customer's key.</h1>
    <p class="lede">The customer signs in their own wallet. Beekle watches Horizon for the memo, asset, and amount, then recognizes the invoice in MySQL. This demo does not submit mainnet transactions and does not store a signing seed.</p>
    <section class="panel">
      <h2>Start a ${escapeHtml(input.assetLabel)} checkout</h2>
      ${
        input.openRegistration
          ? `<form id="demo">
              <label>Amount <input id="amount" name="amount" value="10.0000000" autocomplete="off" /></label>
              <label>Merchant destination (optional)
                <input id="destination" placeholder="G... funded testnet account" autocomplete="off" />
              </label>
              <button type="submit">Create testnet checkout</button>
            </form>
            <p id="result" class="result" hidden></p>`
          : `<p>Demo registration is off. Set <code>DEMO_OPEN_REGISTRATION=true</code> or create a merchant with the API.</p>`
      }
      <ul class="notes">
        <li>${input.usdcConfigured ? 'A blank destination uses Friendbot to fund a testnet account and submits a Circle USDC trustline when that issuer is reachable. The seed is not stored. If the trustline is not confirmed, the checkout is native XLM and says so.' : 'USDC is not configured. A blank destination uses a Friendbot-funded testnet account and requests native XLM.'}</li>
        <li>A pasted destination is checked on Horizon. If it cannot receive the asset, no checkout link is created.</li>
        <li>The customer page hides the QR until Horizon confirms the account can receive the asset.</li>
      </ul>
    </section>
  </main>
  <script>
    const form = document.querySelector('#demo');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const result = document.querySelector('#result');
        result.hidden = false;
        result.textContent = 'Creating checkout…';
        const response = await fetch('/v1/demo/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amount: document.querySelector('#amount').value,
            stellar_destination: document.querySelector('#destination').value || undefined,
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          result.textContent = body.error?.message || 'Could not create checkout';
          return;
        }
        result.innerHTML = '';
        const lines = document.createElement('div');
        lines.innerHTML = '<strong>Checkout ready.</strong>';
        const pre = document.createElement('pre');
        pre.textContent = [
          'asset ' + (body.asset && body.asset.label ? body.asset.label : body.asset && body.asset.code),
          'destination ' + body.destination,
          body.api_key ? 'api key (shown once) ' + body.api_key : '',
          body.friendbot_tx ? 'friendbot tx ' + body.friendbot_tx : '',
          body.trustline_tx ? 'trustline tx ' + body.trustline_tx : '',
          body.note || '',
        ].filter(Boolean).join('\\n');
        const link = document.createElement('a');
        link.href = body.checkout_path;
        link.textContent = 'Open customer checkout';
        link.className = 'go';
        result.append(lines, pre, link);
      });
    }
  </script>
</body>
</html>`;
}

export function renderCheckoutPage(model: CheckoutPageModel): string {
  const label = STATUS_LABEL[model.status] ?? model.status;
  const issuer = model.assetIssuer
    ? `${model.assetIssuer.slice(0, 6)}…${model.assetIssuer.slice(-4)}`
    : 'native';
  const explorerBase =
    model.network === 'mainnet'
      ? 'https://stellar.expert/explorer/public'
      : 'https://stellar.expert/explorer/testnet';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pay ${escapeHtml(model.amount)} ${escapeHtml(model.assetCode)}</title>
  ${styles()}
</head>
<body>
  <header class="top">
    <div class="brand">Beekle <span>Checkout</span></div>
    <div class="pill">${escapeHtml(model.network.toUpperCase())} · customer signs</div>
  </header>
  <main class="wrap checkout">
    <p class="eyebrow">${
      model.assetCode === 'XLM'
        ? 'Native XLM on testnet · not USDC'
        : `Payment request · ${escapeHtml(model.assetCode)} · issuer ${escapeHtml(issuer)}`
    }</p>
    <h1 class="amount">${escapeHtml(model.amount)} <small>${escapeHtml(model.assetCode)}</small></h1>
    <p class="status" id="status" data-status="${escapeHtml(model.status)}">${escapeHtml(label)}</p>
    <p class="readiness" id="readiness" data-ready="${model.readiness.ready ? 'yes' : 'no'}">${escapeHtml(model.readiness.message)}</p>
    <div class="grid">
      <section class="panel qr" id="pay-panel">
        ${
          model.readiness.ready && model.sep7
            ? `<img alt="SEP-7 payment QR" src="/v1/checkout/${escapeHtml(model.id)}/qr.png" width="280" height="280" />
        <a class="go" id="wallet-link" href="${escapeHtml(model.sep7)}">Open in a SEP-7 wallet</a>
        <p class="fine">The QR is a <code>web+stellar:pay</code> URI. It names the testnet passphrase, so a wallet should not send this to the public network.</p>`
            : `<p class="blocked">Payment request withheld. Horizon does not show that this account can receive ${escapeHtml(model.assetCode)} yet.</p>`
        }
      </section>
      <section class="panel facts">
        <dl>
          <div><dt>Memo</dt><dd><code id="memo">${escapeHtml(model.memo)}</code></dd></div>
          <div><dt>Memo type</dt><dd>${escapeHtml(model.memoType)}</dd></div>
          <div><dt>Destination</dt><dd><a href="${explorerBase}/account/${escapeHtml(model.destination)}"><code>${escapeHtml(model.destination)}</code></a></dd></div>
          <div><dt>Received</dt><dd id="received">${escapeHtml(model.receivedAmount)}</dd></div>
          <div><dt>Expires</dt><dd>${escapeHtml(model.expiresAt)}</dd></div>
          <div><dt>Network</dt><dd>${escapeHtml(model.passphrase)}</dd></div>
        </dl>
        ${
          model.providerReference
            ? `<p><a href="${explorerBase}/tx/${escapeHtml(model.providerReference)}">View transaction</a></p>`
            : ''
        }
        <p class="fine">The destination account must already exist and trust this asset. Beekle does not hold the destination secret and cannot refund on-chain. Underpayments, overpayments, wrong assets, and late payments stay in review.</p>
      </section>
    </div>
  </main>
  <script>
    const statusNode = document.querySelector('#status');
    const receivedNode = document.querySelector('#received');
    const labels = ${JSON.stringify(STATUS_LABEL)};
    async function refresh() {
      const response = await fetch('/v1/checkout/${model.id}');
      if (!response.ok) return;
      const body = await response.json();
      statusNode.dataset.status = body.status;
      statusNode.textContent = labels[body.status] || body.status;
      receivedNode.textContent = body.received_amount;
    }
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function styles(): string {
  return `<style>
    :root { color-scheme: light; --navy:#10233f; --ink:#172033; --paper:#f3f6f4; --line:#d7e0da; --teal:#0f766e; --amber:#9a6700; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; background: radial-gradient(1200px 500px at 10% -10%, #e7f3ef, transparent), var(--paper); color: var(--ink); }
    .top { display:flex; justify-content:space-between; align-items:center; padding:18px 28px; background:var(--navy); color:#f8faf8; }
    .brand { font-weight:700; letter-spacing:.04em; }
    .brand span { color:#8fd0c4; font-weight:500; }
    .pill { border:1px solid #3e6d7e; border-radius:999px; padding:6px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; letter-spacing:.08em; }
    .wrap { max-width:980px; margin:0 auto; padding:36px 20px 64px; }
    .eyebrow { letter-spacing:.14em; text-transform:uppercase; font-size:12px; color:var(--teal); font-family: ui-sans-serif, system-ui, sans-serif; }
    h1 { font-size: clamp(32px, 5vw, 54px); line-height:1.05; margin:8px 0 12px; font-weight:650; }
    h1.amount small { font-size:.4em; letter-spacing:.08em; }
    .lede, .fine { font-family: ui-sans-serif, system-ui, sans-serif; line-height:1.5; }
    .panel { background:#fff; border:1px solid var(--line); border-radius:18px; padding:22px; box-shadow: 0 16px 40px rgba(16,35,63,.05); }
    form { display:grid; gap:12px; }
    label { display:grid; gap:6px; font-family: ui-sans-serif, system-ui, sans-serif; font-size:14px; }
    input { font: 16px ui-monospace, SFMono-Regular, Menlo, monospace; padding:12px 14px; border-radius:10px; border:1px solid var(--line); }
    button, .go { background:var(--teal); color:white; border:0; border-radius:999px; padding:12px 18px; font: 600 15px ui-sans-serif, system-ui, sans-serif; text-decoration:none; display:inline-block; width:max-content; }
    .notes { font-family: ui-sans-serif, system-ui, sans-serif; color:#40504a; }
    .result { margin-top:16px; font-family: ui-sans-serif, system-ui, sans-serif; }
    pre { white-space:pre-wrap; background:#f6f8f7; padding:12px; border-radius:10px; }
    .grid { display:grid; grid-template-columns: 320px 1fr; gap:18px; }
    .readiness, .blocked { font-family: ui-sans-serif, system-ui, sans-serif; }
    .readiness[data-ready="no"], .blocked { color:#9f1239; font-weight:650; }
    .status { font-family: ui-sans-serif, system-ui, sans-serif; font-weight:700; color:var(--amber); }
    .status[data-status="CREDITED"], .status[data-status="COMPLETED"] { color:var(--teal); }
    dl { margin:0; display:grid; gap:12px; }
    dt { font-family: ui-sans-serif, system-ui, sans-serif; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#607068; }
    dd { margin:4px 0 0; overflow-wrap:anywhere; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; }
    img { background:white; border-radius:12px; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } .top { padding:16px; } }
  </style>`;
}
