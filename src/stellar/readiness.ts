export type AccountReadiness = {
  exists: boolean;
  nativeBalance: string | null;
  trustline: boolean;
  authorized: boolean;
};

export type ReceivingAssessment = {
  ready: boolean;
  code:
    | 'ready'
    | 'account_missing'
    | 'trustline_missing'
    | 'trustline_unauthorized';
  exists: boolean;
  trustline: boolean;
  authorized: boolean;
  message: string;
};

const MISSING: AccountReadiness = {
  exists: false,
  nativeBalance: null,
  trustline: false,
  authorized: false,
};

export function emptyAccountReadiness(): AccountReadiness {
  return { ...MISSING };
}

/**
 * A checkout may solicit a payment only when Horizon shows the destination can receive it.
 * Native XLM needs an existing account. An issued asset also needs an authorized trustline.
 */
export function assessReceivingReadiness(input: {
  assetCode: string;
  assetIssuer: string | null;
  account: AccountReadiness;
}): ReceivingAssessment {
  const base = {
    exists: input.account.exists,
    trustline: input.account.trustline,
    authorized: input.account.authorized,
  };
  if (!input.account.exists) {
    return {
      ...base,
      ready: false,
      code: 'account_missing',
      message:
        'The receiving account is not on this Stellar network yet, so a payment request would fail. No wallet link is shown.',
    };
  }
  const native = input.assetIssuer === null && input.assetCode === 'XLM';
  if (native) {
    return {
      ...base,
      ready: true,
      code: 'ready',
      trustline: false,
      message:
        'Horizon shows this testnet account exists, so it can receive native XLM. This is not a USDC payment.',
    };
  }
  if (!input.account.trustline) {
    return {
      ...base,
      ready: false,
      code: 'trustline_missing',
      message: `The account exists but has no ${input.assetCode} trustline for the configured issuer. A wallet payment of that asset would fail, so no payment request is shown.`,
    };
  }
  if (!input.account.authorized) {
    return {
      ...base,
      ready: false,
      code: 'trustline_unauthorized',
      message: `The ${input.assetCode} trustline is not authorized. No payment request is shown.`,
    };
  }
  return {
    ...base,
    ready: true,
    code: 'ready',
    message: `Horizon shows this account can receive ${input.assetCode} from the configured issuer.`,
  };
}
