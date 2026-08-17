interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

export function KpiCard({ label, value, sub, accent = "text-emerald-400" }: Props) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={"mt-1 text-2xl font-semibold tabular-nums " + accent}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}
