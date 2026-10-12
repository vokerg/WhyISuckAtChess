/** Preserve source storage; normalize known provider values for domain consumers. */
export function canonicalPlayerColor(value: string | null): string | null {
  const color = value?.toUpperCase();
  return color === 'WHITE' || color === 'BLACK' ? color : value;
}

export function canonicalPlayerResult(value: string | null): string | null {
  const result = value?.toUpperCase();
  return result === 'WIN' || result === 'DRAW' || result === 'LOSS' ? result : value;
}
