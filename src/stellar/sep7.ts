import { formatUriAmount } from '../common/money';

export type Sep7PayInput = {
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  memo: string;
  memoType: 'MEMO_TEXT' | 'MEMO_ID';
  networkPassphrase: string;
  message: string;
};

/**
 * SEP-0007 `web+stellar:pay` URI.
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 *
 * The network passphrase is always included so a wallet does not default
 * this request to the public network. The URI is not domain-signed: this
 * service does not publish a stellar.toml signing key.
 * No `callback` is set. The wallet submits the transaction itself.
 */
export function buildSep7PayUri(input: Sep7PayInput): string {
  const message = input.message.slice(0, 300);
  const pairs: Array<[string, string]> = [
    ['destination', input.destination],
    ['amount', formatUriAmount(input.amount)],
  ];
  if (!(input.assetCode === 'XLM' && input.assetIssuer === null)) {
    pairs.push(['asset_code', input.assetCode]);
    if (!input.assetIssuer) {
      throw new Error('issued assets require asset_issuer in a SEP-7 URI');
    }
    pairs.push(['asset_issuer', input.assetIssuer]);
  }
  pairs.push(
    ['memo', input.memo],
    ['memo_type', input.memoType],
    ['network_passphrase', input.networkPassphrase],
    ['msg', message],
  );
  const query = pairs
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `web+stellar:pay?${query}`;
}
