"use client";

import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";
import { Checkbox } from "./Checkbox";
import { Segmented } from "./Field";
import { Skeleton } from "./Display";
import styles from "./DataTable.module.css";

export type SortDirection = "asc" | "desc";
export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** CSS grid track, e.g. "2fr" or "120px" (default "1fr"). */
  width?: string;
  sortable?: boolean;
  align?: "start" | "end";
  /** Secondary (grey) text, as the email column in C-00. */
  secondary?: boolean;
  tnum?: boolean;
  render?: (row: Row) => ReactNode;
  /** Skeleton cell look while loading. */
  skeleton?: { width?: string; shape?: "line" | "pill" };
}

export interface BulkAction {
  id: string;
  label: string;
  onClick: (selected: string[]) => void;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  label: string;
  /** Enables the checkbox column. */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: BulkAction[];
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  density?: "comfortable" | "compact";
  onDensityChange?: (density: "comfortable" | "compact") => void;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  /** A row-level error (e.g. "Email bounced · Edit email") replacing the last `errorSpan` cells. */
  rowError?: (row: Row) => ReactNode;
  errorSpan?: number;
  /** Rows still loading (e.g. being refreshed) render as skeleton rows in place. */
  rowLoading?: (row: Row) => boolean;
  onRowClick?: (row: Row) => void;
  pagination?: Pagination;
  /** Max height of the scroll area (the header sticks inside it). Without it the header sticks to the page. */
  maxHeight?: number | string;
  /** Visual row state override for the frame gallery: row id → "hover". */
  rowStates?: Record<string, "hover">;
  className?: string;
}

function ariaSort(col: { key: string; sortable?: boolean }, sort?: SortState): "ascending" | "descending" | "none" | undefined {
  if (!col.sortable) return undefined;
  if (sort?.key !== col.key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

/** Page list with at most 5 numbers around the current page. */
export function pageWindow(page: number, pages: number, size = 5): number[] {
  const start = Math.max(1, Math.min(page - Math.floor(size / 2), pages - size + 1));
  return Array.from({ length: Math.min(size, pages) }, (_, i) => start + i);
}

/**
 * Data table (ARIA grid-less table roles on a CSS grid): sticky header, sortable columns (aria-sort), row hover,
 * selection with a mixed header checkbox, bulk bar, skeleton rows, empty row, error rows, density and pagination.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  label,
  selectedIds,
  onSelectionChange,
  bulkActions = [],
  sort,
  onSortChange,
  density = "comfortable",
  onDensityChange,
  loading,
  skeletonRows = 3,
  empty,
  rowError,
  errorSpan = 2,
  rowLoading,
  onRowClick,
  pagination,
  maxHeight,
  rowStates,
  className,
}: DataTableProps<Row>) {
  const selectable = selectedIds !== undefined;
  const selected = new Set(selectedIds ?? []);
  const ids = rows.map(getRowId);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));
  const tracks = [selectable ? "40px" : null, ...columns.map((c) => c.width ?? "1fr")].filter(Boolean).join(" ");
  const style = { "--cols": tracks } as CSSProperties;

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.(ids.filter((i) => next.has(i)).concat([...next].filter((i) => !ids.includes(i))));
  };
  const toggleAll = () => {
    if (allSelected) onSelectionChange?.([...selected].filter((i) => !ids.includes(i)));
    else onSelectionChange?.([...new Set([...selected, ...ids])]);
  };
  const onSort = (key: string) => {
    const direction: SortDirection = sort?.key === key && sort.direction === "asc" ? "desc" : "asc";
    onSortChange?.({ key, direction });
  };

  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const colCount = columns.length + (selectable ? 1 : 0);

  const skeletonRow = (key: string) => (
    <div key={key} role="row" aria-hidden="true" className={styles.row}>
      {selectable ? (
        <div>
          <Checkbox aria-label="" tabIndex={-1} checked={false} />
        </div>
      ) : null}
      {columns.map((c, ci) => (
        <div key={c.key} className={styles.skRow}>
          <Skeleton
            shimmer={ci === 0}
            shape={c.skeleton?.shape}
            width={c.skeleton?.width ?? (c.skeleton?.shape === "pill" ? 64 : "60%")}
            height={c.skeleton?.shape === "pill" ? 18 : 10}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className={cx(styles.table, density === "compact" && styles.compact, className)}>
      {selectable && selected.size > 0 ? (
        <div className={styles.bulk} role="region" aria-label="Bulk actions">
          <span aria-live="polite">{selected.size} selected</span>
          <span className={styles.spacer} />
          {bulkActions.map((a) => (
            <button key={a.id} type="button" className={styles.bulkAction} onClick={() => a.onClick([...selected])}>
              {a.label}
            </button>
          ))}
          <button type="button" className={styles.bulkClose} aria-label="Clear selection" onClick={() => onSelectionChange?.([])}>
            ×
          </button>
        </div>
      ) : null}
      <div className={styles.scroll} style={maxHeight !== undefined ? { maxHeight } : { overflow: "visible" }}>
        <div role="table" aria-label={label} aria-rowcount={pagination ? pagination.total + 1 : undefined} aria-busy={loading || undefined} className={styles.grid} style={style}>
          <div role="rowgroup">
            <div role="row" className={cx(styles.row, styles.head)}>
              {selectable ? (
                <div role="columnheader">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={allSelected ? true : someSelected ? "mixed" : false}
                    onChange={toggleAll}
                    disabled={loading || rows.length === 0}
                  />
                </div>
              ) : null}
              {columns.map((c) => {
                const sorted = sort?.key === c.key;
                return (
                  <div key={c.key} role="columnheader" aria-sort={ariaSort(c, sort)} className={cx(styles.cell, sorted && styles.sorted, c.align === "end" && styles.end)}>
                    {c.sortable ? (
                      <button type="button" className={styles.sort} onClick={() => onSort(c.key)}>
                        {c.header}
                        {sorted ? <span aria-hidden="true">{sort?.direction === "asc" ? "↑" : "↓"}</span> : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div role="rowgroup" className={styles.body}>
            {rows.map((row) => {
              const id = getRowId(row);
              if (rowLoading?.(row)) return skeletonRow(id);
              const error = rowError?.(row);
              const isSelected = selected.has(id);
              const span = Math.min(Math.max(1, errorSpan), columns.length);
              const visible = error ? columns.slice(0, columns.length - span) : columns;
              return (
                <div
                  key={id}
                  role="row"
                  aria-selected={selectable ? isSelected : undefined}
                  data-error={error ? "" : undefined}
                  data-state={rowStates?.[id]}
                  className={styles.row}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {selectable ? (
                    <div role="cell" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Select row ${id}`} checked={isSelected} onChange={() => toggleRow(id)} />
                    </div>
                  ) : null}
                  {visible.map((c) => (
                    <div
                      key={c.key}
                      role="cell"
                      className={cx(styles.cell, c.secondary && styles.secondary, c.tnum && styles.tnum, c.align === "end" && styles.end)}
                    >
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </div>
                  ))}
                  {error ? (
                    <div role="cell" className={cx(styles.cell, styles.errorCell)} style={{ gridColumn: `span ${span}` }}>
                      {error}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {loading ? Array.from({ length: skeletonRows }, (_, i) => skeletonRow(`sk-${i}`)) : null}
            {!loading && rows.length === 0 && empty ? (
              <div role="row" className={cx(styles.row, styles.emptyRow)}>
                <div role="cell" aria-colspan={colCount} className={styles.emptyCell}>
                  {empty}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {pagination || onDensityChange ? (
        <div className={styles.foot}>
          {onDensityChange ? (
            <Segmented
              name={`${label}-density`}
              label="Row density"
              size="sm"
              value={density}
              onChange={(v) => onDensityChange(v as "comfortable" | "compact")}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          ) : (
            <span />
          )}
          {pagination ? (
            <nav aria-label="Pagination" className={styles.pager}>
              <span>
                {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.total, pagination.page * pagination.pageSize)} of{" "}
                {pagination.total} ·
              </span>
              <button type="button" className={styles.pageBtn} aria-label="Previous page" disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)}>
                ‹
              </button>
              {pageWindow(pagination.page, pages).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.pageBtn}
                  aria-label={`Page ${p}`}
                  aria-current={p === pagination.page ? "page" : undefined}
                  onClick={() => pagination.onPageChange(p)}
                >
                  {p}
                </button>
              ))}
              <button type="button" className={styles.pageBtn} aria-label="Next page" disabled={pagination.page >= pages} onClick={() => pagination.onPageChange(pagination.page + 1)}>
                ›
              </button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
