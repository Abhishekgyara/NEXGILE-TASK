const CURRENCY_MINOR: Record<string, number> = { USD: 100, EUR: 100, GBP: 100 };

export function moneyMinor(amountMinor: number, currency = 'USD'): string {
  const major = amountMinor / (CURRENCY_MINOR[currency] ?? 100);
  return major.toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function signedMoneyMinor(amountMinor: number, currency = 'USD'): string {
  const prefix = amountMinor > 0 ? '+' : '';
  return prefix + moneyMinor(amountMinor, currency);
}

export function num(value: number): string {
  return value.toLocaleString('en-US');
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function currencySymbol(currency: string): string {
  return moneyMinor(0, currency).replace('0.00', '').trim();
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
