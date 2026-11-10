import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Star } from "lucide-react";
import type { Account, Campaign, Channel, Product, Totals } from "../../data/mock";
import { cpaOf, ctrOf, cpmOf, orgName, productById, roiOf } from "../../data/mock";
import { fmtInt, fmtMoney, fmtPct, fmtRoi } from "../../lib/format";
import { Checkbox, StatusBadge, Switch } from "../../components/ui";
import type { ColumnMeta } from "./columns";

export interface AccountRow {
  account: Account;
  totals: Totals;
  prev: Totals;
}

export interface CampaignRow {
  campaign: Campaign;
  account: Account;
  totals: Totals;
  prev: Totals;
}

export type SortState = { key: string; dir: "asc" | "desc" };

/* ------------------------------------------------------------------ */
/* Header                                                             */
/* ------------------------------------------------------------------ */

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown size={11} className="sort-glyph" />;
  return dir === "asc" ? <ArrowUp size={11} className="sort-glyph is-active" /> : <ArrowDown size={11} className="sort-glyph is-active" />;
}

function Th({
  children,
  align = "left",
  active,
  dir,
  sortable,
  onClick,
  className = "",
  style,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  active?: boolean;
  dir?: "asc" | "desc";
  sortable?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <th
      className={`${align === "right" ? "align-right" : align === "center" ? "align-center" : ""} ${active ? "is-sorted" : ""} ${className}`}
      style={style}
      scope="col"
    >
      {sortable ? (
        <button type="button" className="th-sort-btn" onClick={onClick} aria-label={`按${typeof children === "string" ? children : "该列"}排序`}>
          <span className="th-inner">
            <span>{children}</span>
            <SortIcon active={Boolean(active)} dir={dir ?? "desc"} />
          </span>
        </button>
      ) : (
        <span className="th-inner">{children}</span>
      )}
    </th>
  );
}

function TwoLine({ label, sub }: { label: string; sub?: string }) {
  return (
    <>
      {label}
      {sub && (
        <>
          <br />
          {sub}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cell renderers                                                     */
/* ------------------------------------------------------------------ */

function moneyCell(value: number | null, options?: { strong?: boolean; low?: boolean }) {
  return (
    <span className={`money ${options?.strong ? "strong" : ""} ${options?.low ? "balance-low" : ""} ${value === null ? "muted" : ""}`}>
      {value === null ? "--" : fmtMoney(value)}
    </span>
  );
}

function roiCell(value: number | null, prev: number | null) {
  const up = value !== null && prev !== null && value > prev;
  return (
    <span className="roi-cell">
      {value === null ? "--" : fmtRoi(value)}
      {value !== null && prev !== null && Math.abs(value - prev) > 0.02 && (
        <span className={`trend ${up ? "up" : "down"}`}>
          {up ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
        </span>
      )}
    </span>
  );
}

function AccountInfoCell({
  account,
  onOpen,
  onToggleFollow,
  agentTouched = false,
  productCount,
}: {
  account: Account;
  onOpen: () => void;
  onToggleFollow: () => void;
  agentTouched?: boolean;
  productCount?: number;
}) {
  return (
    <div className="account-cell">
      <span
        className="avatar-square"
        style={{ background: `linear-gradient(135deg, ${account.color[0]}, ${account.color[1]})` }}
        aria-hidden="true"
      >
        {account.short.slice(0, 1)}
      </span>
      <div className="account-main">
        <button type="button" className="account-name" onClick={onOpen} title={account.name}>
          {account.name}
          {agentTouched && <span className="agent-mark" title="Agent 已调整该账户">Agent</span>}
        </button>
        <div className="account-meta">
          <button
            type="button"
            className={`follow-star ${account.followed ? "is-on" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFollow();
            }}
            aria-label={account.followed ? "取消关注" : "关注账户"}
            title={account.followed ? "取消关注" : "关注账户"}
          >
            <Star size={11} fill={account.followed ? "currentColor" : "none"} />
          </button>
          <span className="id">ID: {account.id}</span>
          {productCount ? (
            <span className="account-products" title="店铺商品数">
              · {productCount} 个商品
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function accountCell(columnId: string, row: AccountRow): ReactNode {
  const { account, totals, prev } = row;
  switch (columnId) {
    case "status":
      return <StatusBadge status={account.status} />;
    case "role":
      return <span className="role-cell">{account.role}</span>;
    case "budget":
      return <span className="money">{fmtMoney(account.budget)}</span>;
    case "org":
      return (
        <span className="org-path" title={orgName(account.orgId)}>
          {orgName(account.orgId)}
        </span>
      );
    case "remark":
      return (
        <span className="remark-cell" title={account.remark}>
          {account.remark}
        </span>
      );
    case "balance":
      return moneyCell(account.balance, { low: account.balance < 5000 });
    case "bidBalance":
      return moneyCell(account.balance * 0.82);
    case "cost":
      return moneyCell(totals.cost, { strong: true });
    case "roi":
      return roiCell(roiOf(totals), roiOf(prev));
    case "payAmount":
      return moneyCell(totals.revenue);
    case "orders":
      return <span className="money">{fmtInt(totals.orders)}</span>;
    case "cpa":
      return moneyCell(cpaOf(totals));
    case "shows":
      return <span className="money">{fmtInt(totals.show)}</span>;
    case "clicks":
      return <span className="money">{fmtInt(totals.click)}</span>;
    case "ctr":
      return <span className="money">{fmtPct(ctrOf(totals))}</span>;
    case "cpm":
      return <span className="money">{fmtMoney(cpmOf(totals))}</span>;
    default:
      return null;
  }
}

function accountFooter(columnId: string, rows: AccountRow[]): ReactNode {
  const cost = rows.reduce((sum, row) => sum + row.totals.cost, 0);
  const revenue = rows.reduce((sum, row) => sum + row.totals.revenue, 0);
  const orders = rows.reduce((sum, row) => sum + row.totals.orders, 0);
  const show = rows.reduce((sum, row) => sum + row.totals.show, 0);
  const click = rows.reduce((sum, row) => sum + row.totals.click, 0);
  switch (columnId) {
    case "balance":
      return <span className="money strong">{fmtMoney(rows.reduce((sum, row) => sum + row.account.balance, 0))}</span>;
    case "bidBalance":
      return <span className="money strong">{fmtMoney(rows.reduce((sum, row) => sum + row.account.balance * 0.82, 0))}</span>;
    case "cost":
      return <span className="money strong">{fmtMoney(cost)}</span>;
    case "roi":
      return <span className="money strong">{fmtRoi(cost > 0 ? revenue / cost : null)}</span>;
    case "payAmount":
      return <span className="money strong">{fmtMoney(revenue)}</span>;
    case "orders":
      return <span className="money strong">{fmtInt(orders)}</span>;
    case "cpa":
      return <span className="money strong">{fmtMoney(orders > 0 ? cost / orders : null)}</span>;
    case "budget":
      return <span className="money strong">{fmtMoney(rows.reduce((sum, row) => sum + row.account.budget, 0))}</span>;
    case "shows":
      return <span className="money strong">{fmtInt(show)}</span>;
    case "clicks":
      return <span className="money strong">{fmtInt(click)}</span>;
    case "ctr":
      return <span className="money strong">{fmtPct(show > 0 ? (click / show) * 100 : null)}</span>;
    case "cpm":
      return <span className="money strong">{fmtMoney(show > 0 ? (cost / show) * 1000 : null)}</span>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Account table                                                      */
/* ------------------------------------------------------------------ */

export function AccountTable({
  rows,
  columns,
  channel,
  selected,
  onSelect,
  onSelectAll,
  sort,
  onSort,
  onOpenAccount,
  onToggleFollow,
  density,
  footerRows,
  agentAccountIds,
  productCounts,
}: {
  rows: AccountRow[];
  columns: ColumnMeta[];
  channel: Channel;
  selected: Set<string>;
  onSelect: (id: string, next: boolean) => void;
  onSelectAll: (next: boolean) => void;
  sort: SortState;
  onSort: (key: string) => void;
  onOpenAccount: (account: Account) => void;
  onToggleFollow: (account: Account) => void;
  density: "default" | "compact";
  footerRows?: AccountRow[];
  agentAccountIds?: Set<string>;
  productCounts?: Map<string, number>;
}) {
  const selectable = rows.length > 0;
  const allChecked = selectable && rows.every((row) => selected.has(row.account.id));
  const someChecked = rows.some((row) => selected.has(row.account.id));
  const tableWidth = 36 + 248 + 52 + columns.reduce((sum, column) => sum + (column.width ?? 110), 0);

  return (
    <div className={`table-wrap density-${density}`}>
      <table className="grid account-grid" style={{ minWidth: tableWidth }}>
        <thead>
          <tr>
            <th className="col-check col-sticky" scope="col">
              <Checkbox
                checked={allChecked}
                indeterminate={!allChecked && someChecked}
                onChange={onSelectAll}
                ariaLabel="全选账户"
              />
            </th>
            <th className="col-sticky-2 col-account" scope="col">
              账户信息
            </th>
            <th className="col-action" scope="col">
              操作
            </th>
            {columns.map((column) => (
              <Th
                key={column.id}
                align={column.align}
                active={sort.key === column.id}
                dir={sort.dir}
                sortable={column.sortable}
                onClick={() => onSort(column.id)}
                style={column.width ? { width: column.width } : undefined}
              >
                <TwoLine label={column.label} sub={column.sub} />
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selected.has(row.account.id);
            return (
              <tr key={row.account.id} className={isSelected ? "is-selected" : ""}>
                <td className="col-check col-sticky">
                  <Checkbox
                    checked={isSelected}
                    onChange={(next) => onSelect(row.account.id, next)}
                    ariaLabel={`选择${row.account.name}`}
                  />
                </td>
                <td className="col-sticky-2">
                  <AccountInfoCell
                    account={row.account}
                    onOpen={() => onOpenAccount(row.account)}
                    onToggleFollow={() => onToggleFollow(row.account)}
                    agentTouched={agentAccountIds?.has(row.account.id)}
                    productCount={productCounts?.get(row.account.id)}
                  />
                </td>
                <td className="col-action">
                  <button
                    type="button"
                    className="btn-link"
                    title="查看商品与推广计划"
                    onClick={() => onOpenAccount(row.account)}
                  >
                    查看
                  </button>
                </td>
                {columns.map((column) => (
                  <td key={column.id} className={column.align === "right" ? "align-right" : ""}>
                    {accountCell(column.id, row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="col-check col-sticky" />
            <td className="col-sticky-2">
              合计（{(footerRows ?? rows).length}项）
            </td>
            <td />
            {columns.map((column) => (
              <td key={column.id} className={column.align === "right" ? "align-right" : ""}>
                {accountFooter(column.id, footerRows ?? rows)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campaign table                                                     */
/* ------------------------------------------------------------------ */

function campaignCell(
  columnId: string,
  row: CampaignRow,
  onOpenAccount: () => void,
  resolveProduct?: (id: string) => Product | undefined,
): ReactNode {
  const { campaign, account, totals, prev } = row;
  switch (columnId) {
    case "cost":
      return moneyCell(totals.cost, { strong: true });
    case "roi":
      return roiCell(roiOf(totals), roiOf(prev));
    case "payAmount":
      return moneyCell(totals.revenue);
    case "orders":
      return <span className="money">{fmtInt(totals.orders)}</span>;
    case "cpa":
      return moneyCell(cpaOf(totals));
    case "shows":
      return <span className="money">{fmtInt(totals.show)}</span>;
    case "clicks":
      return <span className="money">{fmtInt(totals.click)}</span>;
    case "ctr":
      return <span className="money">{fmtPct(ctrOf(totals))}</span>;
    case "cpm":
      return <span className="money">{fmtMoney(cpmOf(totals))}</span>;
    case "product": {
      const product = (resolveProduct ?? productById)(campaign.productId);
      if (!product) return <span className="muted-cell">--</span>;
      return (
        <div className="prod-cell">
          <span className="prod-thumb" aria-hidden="true">
            {product.emoji}
          </span>
          <span className="prod-text">
            <span className="prod-name" title={product.name}>
              {product.name}
            </span>
            <span className="prod-price">¥{fmtMoney(product.price)}</span>
          </span>
        </div>
      );
    }
    case "douyin":
      return <span className="plan-meta id">{campaign.douyinId}</span>;
    case "account":
      return (
        <button type="button" className="btn-link" onClick={onOpenAccount}>
          {account.name}
        </button>
      );
    case "budget":
      return <span className="money">{fmtMoney(campaign.budget)}</span>;
    case "bid":
      return <span className="money">{fmtMoney(campaign.bid)}</span>;
    case "status":
      return <StatusBadge status={campaign.status} />;
    default:
      return null;
  }
}

function campaignFooter(columnId: string, rows: CampaignRow[]): ReactNode {
  const cost = rows.reduce((sum, row) => sum + row.totals.cost, 0);
  const revenue = rows.reduce((sum, row) => sum + row.totals.revenue, 0);
  const orders = rows.reduce((sum, row) => sum + row.totals.orders, 0);
  const show = rows.reduce((sum, row) => sum + row.totals.show, 0);
  const click = rows.reduce((sum, row) => sum + row.totals.click, 0);
  switch (columnId) {
    case "cost":
      return <span className="money strong">{fmtMoney(cost)}</span>;
    case "payAmount":
      return <span className="money strong">{fmtMoney(revenue)}</span>;
    case "orders":
      return <span className="money strong">{fmtInt(orders)}</span>;
    case "roi":
      return <span className="money strong">{fmtRoi(cost > 0 ? revenue / cost : null)}</span>;
    case "cpa":
      return <span className="money strong">{fmtMoney(orders > 0 ? cost / orders : null)}</span>;
    case "shows":
      return <span className="money strong">{fmtInt(show)}</span>;
    case "clicks":
      return <span className="money strong">{fmtInt(click)}</span>;
    case "ctr":
      return <span className="money strong">{fmtPct(show > 0 ? (click / show) * 100 : null)}</span>;
    case "cpm":
      return <span className="money strong">{fmtMoney(show > 0 ? (cost / show) * 1000 : null)}</span>;
    case "budget":
      return <span className="money strong">{fmtMoney(rows.reduce((sum, row) => sum + row.campaign.budget, 0))}</span>;
    default:
      return null;
  }
}

export function CampaignTable({
  rows,
  columns,
  selected,
  onSelect,
  onSelectAll,
  sort,
  onSort,
  onOpenAccount,
  onToggleCampaign,
  onOpenCampaign,
  density,
  footerRows,
  agentPlanIds,
  resolveProduct,
}: {
  rows: CampaignRow[];
  columns: ColumnMeta[];
  selected: Set<string>;
  onSelect: (id: string, next: boolean) => void;
  onSelectAll: (next: boolean) => void;
  sort: SortState;
  onSort: (key: string) => void;
  onOpenAccount: (account: Account) => void;
  onToggleCampaign: (campaign: Campaign, next: boolean) => void;
  onOpenCampaign: (campaign: Campaign) => void;
  density: "default" | "compact";
  footerRows?: CampaignRow[];
  agentPlanIds?: Set<string>;
  resolveProduct?: (id: string) => Product | undefined;
}) {
  const allChecked = rows.length > 0 && rows.every((row) => selected.has(row.campaign.id));
  const someChecked = rows.some((row) => selected.has(row.campaign.id));
  const tableWidth = 40 + 64 + 300 + columns.reduce((sum, column) => sum + (column.width ?? 110), 0);

  return (
    <div className={`table-wrap density-${density}`}>
      <table className="grid" style={{ minWidth: tableWidth }}>
        <thead>
          <tr>
            <th className="col-check col-sticky" scope="col">
              <Checkbox checked={allChecked} indeterminate={!allChecked && someChecked} onChange={onSelectAll} ariaLabel="全选推广" />
            </th>
            <th className="col-switch col-sticky-1" scope="col" style={{ width: 64 }}>
              开关
            </th>
            <th className="col-sticky-2 col-plan" scope="col" style={{ left: 104 }}>
              计划信息
            </th>
            {columns.map((column) => (
              <Th
                key={column.id}
                align={column.align}
                active={sort.key === column.id}
                dir={sort.dir}
                sortable={column.sortable}
                onClick={() => onSort(column.id)}
                style={column.width ? { width: column.width } : undefined}
              >
                <TwoLine label={column.label} sub={column.sub} />
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selected.has(row.campaign.id);
            return (
              <tr key={row.campaign.id} className={isSelected ? "is-selected" : ""}>
                <td className="col-check col-sticky">
                  <Checkbox checked={isSelected} onChange={(next) => onSelect(row.campaign.id, next)} ariaLabel={`选择${row.campaign.name}`} />
                </td>
                <td className="col-switch col-sticky-1">
                  <Switch
                    checked={row.campaign.status === "投放中"}
                    onChange={(next) => onToggleCampaign(row.campaign, next)}
                    ariaLabel={`${row.campaign.name} 启停`}
                  />
                </td>
                <td className="col-sticky-2" style={{ left: 104 }}>
                  <div className="plan-cell">
                    <button type="button" className="plan-name" onClick={() => onOpenCampaign(row.campaign)} title={row.campaign.name}>
                      {row.campaign.name}
                      {agentPlanIds?.has(row.campaign.id) && <span className="agent-mark" title="Agent 已调整该计划">Agent</span>}
                    </button>
                    <div className="plan-meta">
                      <span className="tag tag-outline">{row.campaign.mode}</span>
                      <span className="tag tag-outline">{row.campaign.target}</span>
                      {row.campaign.brandPlacement && (
                        <span className="tag tag-outline">{row.campaign.brandPlacement}</span>
                      )}
                      <span className="id">ID: {row.campaign.id}</span>
                    </div>
                  </div>
                </td>
                {columns.map((column) => (
                  <td key={column.id} className={column.align === "right" ? "align-right" : ""}>
                    {campaignCell(column.id, row, () => onOpenAccount(row.account), resolveProduct)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="col-check col-sticky" />
            <td className="col-switch col-sticky-1" />
            <td className="col-sticky-2" style={{ left: 104 }}>
              合计（{(footerRows ?? rows).length}项）
            </td>
            {columns.map((column) => (
              <td key={column.id} className={column.align === "right" ? "align-right" : ""}>
                {campaignFooter(column.id, footerRows ?? rows)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                         */
/* ------------------------------------------------------------------ */

export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  for (let index = start; index <= Math.min(pageCount, start + 4); index += 1) pages.push(index);

  return (
    <div className="pagination">
      <span className="total">
        共 {total.toLocaleString("zh-CN")} 条
      </span>
      <div className="page-size">
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label="每页条数">
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size} 条/页
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页">
        <ChevronLeft size={14} />
      </button>
      {start > 1 && (
        <>
          <button type="button" className="page-btn" onClick={() => onPage(1)}>
            1
          </button>
          <span className="page-ellipsis">…</span>
        </>
      )}
      {pages.map((item) => (
        <button
          key={item}
          type="button"
          className={`page-btn ${item === page ? "is-active" : ""}`}
          onClick={() => onPage(item)}
        >
          {item}
        </button>
      ))}
      {pageCount > start + 4 && (
        <>
          <span className="page-ellipsis">…</span>
          <button type="button" className="page-btn" onClick={() => onPage(pageCount)}>
            {pageCount}
          </button>
        </>
      )}
      <button type="button" className="page-btn" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="下一页">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
