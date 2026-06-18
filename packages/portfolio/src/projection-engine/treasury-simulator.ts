// Tracks EURC, cash, and fiscal reserve separately during a projection.
// Never mixes the three pools.

export interface TreasuryState {
  cashEur: number;
  eurcEur: number;           // total EURC held (includes fiscal reserve)
  fiscalReserveEur: number;  // portion of eurcEur blocked for taxes
  taxPendingEur: number;
  taxPaidEur: number;
}

export function initTreasuryState(cash: number, eurc: number, fiscalReserve: number): TreasuryState {
  return {
    cashEur: Math.max(0, cash),
    eurcEur: Math.max(0, eurc),
    fiscalReserveEur: Math.max(0, fiscalReserve),
    taxPendingEur: Math.max(0, fiscalReserve),
    taxPaidEur: 0,
  };
}

export function eurcAvailable(state: TreasuryState): number {
  return Math.max(0, state.eurcEur - state.fiscalReserveEur);
}

export function addSaleProceeds(
  state: TreasuryState,
  grossEur: number,
  taxEur: number,
): TreasuryState {
  const netEurc = Math.max(0, grossEur - taxEur);
  return {
    ...state,
    eurcEur: state.eurcEur + grossEur,
    fiscalReserveEur: state.fiscalReserveEur + taxEur,
    taxPendingEur: state.taxPendingEur + taxEur,
  };
}

export function consumeEurcForRebuy(state: TreasuryState, amountEur: number): TreasuryState {
  const available = eurcAvailable(state);
  const consume = Math.min(amountEur, available);
  return {
    ...state,
    eurcEur: Math.max(0, state.eurcEur - consume),
  };
}

export function consumeCashForContribution(state: TreasuryState, amountEur: number): TreasuryState {
  return {
    ...state,
    cashEur: Math.max(0, state.cashEur - amountEur),
  };
}

export function recordTaxPayment(state: TreasuryState, amountEur: number): TreasuryState {
  const pay = Math.min(amountEur, state.fiscalReserveEur);
  return {
    ...state,
    eurcEur: Math.max(0, state.eurcEur - pay),
    fiscalReserveEur: Math.max(0, state.fiscalReserveEur - pay),
    taxPendingEur: Math.max(0, state.taxPendingEur - pay),
    taxPaidEur: state.taxPaidEur + pay,
  };
}
