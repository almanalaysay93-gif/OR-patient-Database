import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { BOARD_PAGE_SIZE, pageBoardRows } from "../../services/preOrBoardTable";

export interface DataColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  nowrap?: boolean;
  align?: "left" | "right";
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Text matched against the search box. Omit to hide the search box. */
  searchText?: (row: T) => string;
  searchLabel?: string;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  emptyMessage?: string;
  pageSize?: number;
  /** Extra controls shown on the toolbar, next to the search box. */
  toolbar?: React.ReactNode;
  /** Table caption for screen readers. */
  caption: string;
}

const HEAD: React.CSSProperties = {
  padding: "12px 14px", fontWeight: 700, fontSize: "12px", color: "var(--text-muted)",
  whiteSpace: "nowrap", textAlign: "left", borderBottom: "1px solid var(--border-glass)",
};
const CELL: React.CSSProperties = { padding: "12px 14px", fontSize: "13px", color: "var(--text-main)", borderBottom: "1px solid var(--border-subtle)", verticalAlign: "middle" };

/**
 * Shared record table: search, fixed-size pages, sticky header.
 * No infinite scroll. Every page is a fixed slice, so the table stays fast on long lists.
 */
export function DataTable<T>({
  columns, rows, rowKey, searchText, searchLabel = "Search", searchPlaceholder = "Search",
  onRowClick, isSelected, emptyMessage = "No records.", pageSize = BOARD_PAGE_SIZE, toolbar, caption,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!searchText || terms.length === 0) return rows;
    return rows.filter((r) => {
      const hay = searchText(r).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, query, searchText]);

  const pageData = pageBoardRows(matches, page, pageSize);

  return (
    <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
      {(searchText || toolbar) && (
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--border-glass)" }}>
          {searchText && (
            <div style={{ position: "relative", flex: "1 1 260px", maxWidth: "420px" }}>
              <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-subtle)" }} />
              <input
                className="glass-input"
                type="search"
                aria-label={searchLabel}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                style={{ width: "100%", paddingLeft: 36 }}
              />
            </div>
          )}
          {toolbar}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" style={{ ...HEAD, textAlign: c.align ?? "left", width: c.width }}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.rows.map((row) => {
              const selected = isSelected?.(row) ?? false;
              return (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ cursor: onRowClick ? "pointer" : "default", background: selected ? "var(--primary-light)" : "transparent" }}
                >
                  {columns.map((c) => (
                    <td key={c.key} style={{ ...CELL, textAlign: c.align ?? "left", whiteSpace: c.nowrap ? "nowrap" : undefined }}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {pageData.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ ...CELL, textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                  {rows.length === 0 ? emptyMessage : "No matches for this search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label={`${caption} pages`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "10px 14px", borderTop: "1px solid var(--border-glass)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }} aria-live="polite">
          {pageData.total === 0 ? "0 records" : `Showing ${pageData.from}-${pageData.to} of ${pageData.total}`}
        </span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button type="button" className="glass-btn glass-btn-secondary" disabled={pageData.page <= 1}
            onClick={() => setPage(pageData.page - 1)} style={{ padding: "6px 10px" }} aria-label="Previous page">
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: "12px", color: "var(--text-main)" }}>Page {pageData.page} of {pageData.pageCount}</span>
          <button type="button" className="glass-btn glass-btn-secondary" disabled={pageData.page >= pageData.pageCount}
            onClick={() => setPage(pageData.page + 1)} style={{ padding: "6px 10px" }} aria-label="Next page">
            <ChevronRight size={14} />
          </button>
        </div>
      </nav>
    </div>
  );
}
