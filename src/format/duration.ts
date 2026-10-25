/** A run's length as S-08 shows it: "45 s", "14 min", "1 h 5 min" (docs/03 › Copy style). */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${String(Math.max(0, Math.round(seconds)))} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}
