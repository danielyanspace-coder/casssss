// Границы: до 5000 включительно 20%, до 10000 включительно 18%, выше 15%.
export function siciliaPayinFeePct(amount, method) {
  if (method === 'mk') return 26;
  return Number(amount) <= 5000 ? 20 : Number(amount) <= 10000 ? 18 : 15;
}
