interface Item {
  name?: string | number
  value?: number | string | (number | string)[]
  color?: string
  dataKey?: string | number
}

interface Props {
  active?: boolean
  payload?: Item[]
  label?: string | number
  labelFormat?: (l: string) => string
  valueFormat?: (v: number) => string
}

/** themed tooltip used by all charts */
export function ChartTooltip({ active, payload, label, labelFormat, valueFormat }: Props) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip">
      <div className="t">{labelFormat ? labelFormat(String(label)) : label}</div>
      {payload.map(p => (
        <div className="row" key={String(p.dataKey ?? p.name)}>
          <i style={{ background: p.color }} />
          <span>{p.name}: {typeof p.value === 'number' && valueFormat ? valueFormat(p.value) : String(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map(i => (
        <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  )
}
