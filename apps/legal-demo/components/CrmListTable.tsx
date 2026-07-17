'use client'

// Shared CRM list table (li-wp-j) — the comp's grid table with a status filter
// select embedded directly in its own column header (the WIRING.md ADAPT item:
// "status filter-in-header-column pattern") instead of a separate filter bar.
// Used by both the Clients list and the Contacts list; each page supplies its
// own column set and its own row data, this component owns only the shared
// chrome (grid layout, sort state, the embedded status filter).
import { type ReactNode, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon } from '@/components/icons'
import { CRM_STATUS_FILTER_OPTIONS, type CrmBucket } from '@/lib/crmStatus'

export interface CrmColumn<T> {
  key: string
  label: string
  /** Grid track width, e.g. '1.6fr'. */
  width: string
  render: (row: T) => ReactNode
  /** Omit for a column that can't be sorted — its header renders as plain text,
   *  no caret, no button (no-op sortability is worse than none). */
  sortValue?: (row: T) => string | number
}

export function CrmListTable<T>({
  rows,
  columns,
  getRowKey,
  getHref,
  statusColumnKey,
  statusValue,
  onStatusChange,
  emptyLabel,
}: {
  rows: T[]
  columns: CrmColumn<T>[]
  getRowKey: (row: T) => string
  getHref: (row: T) => string
  /** Which column's header hosts the embedded status filter. */
  statusColumnKey: string
  statusValue: CrmBucket | ''
  onStatusChange: (value: CrmBucket | '') => void
  emptyLabel: string
}): ReactNode {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir
    })
  }, [rows, columns, sortKey, sortDir])

  function toggleSort(key: string): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const gridTemplateColumns = columns.map((c) => c.width).join(' ')

  return (
    <div className="li-crm-table">
      <div className="li-crm-thead" style={{ gridTemplateColumns }}>
        {columns.map((col) =>
          col.key === statusColumnKey ? (
            <span key={col.key} className="li-crm-statusfilter">
              <select
                aria-label="Filter by status"
                value={statusValue}
                onChange={(e) => onStatusChange(e.target.value as CrmBucket | '')}
              >
                {CRM_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={11} />
            </span>
          ) : col.sortValue ? (
            <button
              key={col.key}
              type="button"
              className="li-crm-th"
              onClick={() => toggleSort(col.key)}
              aria-sort={
                sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
              }
            >
              {col.label}
              <ChevronDownIcon
                size={12}
                style={{
                  opacity: sortKey === col.key ? 1 : 0.35,
                  transform: sortKey === col.key && sortDir === 'asc' ? 'rotate(180deg)' : 'none',
                }}
              />
            </button>
          ) : (
            <span key={col.key} className="li-crm-th li-crm-th-static">
              {col.label}
            </span>
          ),
        )}
      </div>
      <div className="li-crm-tbody">
        {sorted.length === 0 ? (
          <div className="li-crm-empty">{emptyLabel}</div>
        ) : (
          sorted.map((row) => (
            <Link
              key={getRowKey(row)}
              href={getHref(row)}
              className="li-crm-row"
              style={{ gridTemplateColumns }}
            >
              {columns.map((col) => (
                <span key={col.key} className="li-crm-cell">
                  {col.render(row)}
                </span>
              ))}
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
