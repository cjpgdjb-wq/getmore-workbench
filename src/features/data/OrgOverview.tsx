import { useMemo, useState } from "react";
import { Building2, ChevronDown, ExternalLink } from "lucide-react";
import {
  addTotals,
  accountsOfOrgs,
  cpaOf,
  dailyTotals,
  descenders,
  orgById,
  roiOf,
  sumSeries,
  type Account,
  type Channel,
  type DateRange,
  type Org,
} from "../../data/mock";
import { fmtInt, fmtMoney, fmtRoi } from "../../lib/format";
import { Sparkline } from "../../components/ui";

function subtreeAccounts(orgId: string, accounts: Account[], channel: Channel): Account[] {
  const ids = new Set(descenders(orgId));
  return accounts.filter((account) => ids.has(account.orgId) && account.channel === channel);
}

function subtreeTotals(orgId: string, accounts: Account[], channel: Channel, range: DateRange) {
  return addTotals(subtreeAccounts(orgId, accounts, channel).map((account) => sumSeries(account.daily, range)));
}

const LEVEL_LABEL: Record<number, string> = {
  0: "集团",
  1: "二级组织",
  2: "三级组织",
};

export default function OrgOverview({
  rootId,
  channel,
  range,
  accounts,
  search,
  onDrill,
}: {
  rootId: string;
  channel: Channel;
  range: DateRange;
  accounts: Account[];
  search: string;
  onDrill: (orgId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const orgs = useMemo(() => {
    const root = orgById(rootId);
    if (!root) return [];
    const query = search.trim().toLowerCase();
    return root.children
      .map((id) => orgById(id))
      .filter((org): org is Org => Boolean(org))
      .filter((org) => subtreeAccounts(org.id, accounts, channel).length > 0)
      .filter((org) => {
        if (!query) return true;
        const names = descenders(org.id)
          .map((id) => orgById(id)?.name ?? "")
          .join(" ");
        return org.name.toLowerCase().includes(query) || org.id.includes(query) || names.toLowerCase().includes(query);
      });
  }, [rootId, search, accounts, channel]);

  const allExpanded = orgs.length > 0 && orgs.every((org) => expanded.has(org.id));
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="org-wrap">
      <div className="org-tools">
        <span className="org-hint">
          组织总览 · 共 {orgs.length} 个{rootId === "710000000000000001" ? "一级组织" : "下级组织"}
          {search ? ` · 搜索「${search}」` : ""}
        </span>
        <div className="org-tools-actions">
          <button
            type="button"
            className="text-action"
            onClick={() => setExpanded(new Set(allExpanded ? [] : orgs.map((org) => org.id)))}
          >
            {allExpanded ? "全部收起" : "全部展开"}
          </button>
        </div>
      </div>

      <div className="org-list">
        {orgs.length === 0 && (
          <div className="empty">
            <div className="empty-art">
              <Building2 size={26} />
            </div>
            <div className="empty-title">没有匹配的组织</div>
            <div className="empty-desc">试试调整搜索关键词或返回上级组织</div>
          </div>
        )}

        {orgs.map((org) => {
          const childOrgs = org.children
            .map((id) => orgById(id))
            .filter((child): child is Org => Boolean(child));
          const directAccounts = accounts.filter((account) => account.orgId === org.id && account.channel === channel);
          const allAccounts = subtreeAccounts(org.id, accounts, channel);
          const totals = subtreeTotals(org.id, accounts, channel, range);
          const isOpen = expanded.has(org.id);
          const daily = dailyTotals(
            allAccounts.map((account) => account.daily),
            range,
          );
          const spark = daily.map((item) => item.totals.cost);
          const levelLabel = LEVEL_LABEL[org.level] ?? "组织";

          return (
            <section key={org.id} className={`org-card ${isOpen ? "is-open" : ""}`}>
              <div className="org-card-head">
                <span className="org-icon" aria-hidden="true">
                  <Building2 size={18} />
                </span>
                <div className="org-title-wrap">
                  <div className="org-title">
                    {org.name}
                    <span className="tag tag-blue">{levelLabel}</span>
                  </div>
                  <div className="org-info">
                    <span>ID: {org.id}</span>
                    <span className="sep" />
                    <span>
                      直属组织 <b>{childOrgs.length}</b>
                    </span>
                    <span>
                      直属账户 <b>{directAccounts.length}</b>
                    </span>
                    <span className="sep" />
                    <button type="button" className="btn-link" onClick={() => onDrill(org.id)}>
                      查看所有账户 <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
                <div className="org-head-right">
                  <span className="org-spark">
                    <Sparkline values={spark.length > 1 ? spark : [0, 0, 0]} width={72} height={22} />
                  </span>
                  <div className="org-cost">
                    <span className="label">消耗(元)</span>
                    <span className="value">{fmtMoney(totals.cost)}</span>
                  </div>
                  <div className="org-cost">
                    <span className="label">整体支付ROI</span>
                    <span className="value">{fmtRoi(roiOf(totals))}</span>
                  </div>
                  <button type="button" className="org-toggle" onClick={() => toggle(org.id)} aria-expanded={isOpen}>
                    {isOpen ? "收起" : "展开"}
                    <ChevronDown size={12} className="chev" />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="org-body">
                  {childOrgs.length > 0 ? (
                    <div className="org-table-scroll">
                      <table className="org-grid">
                        <thead>
                          <tr>
                            <th>团队信息</th>
                            <th style={{ width: 120 }}>操作</th>
                            <th style={{ width: 112 }}>直属账户</th>
                            <th className="align-right">总余额</th>
                            <th className="align-right">整体消耗</th>
                            <th className="align-right">
                              用户实际支付
                              <br />
                              金额
                            </th>
                            <th className="align-right">
                              整体成交订单
                              <br />
                              数
                            </th>
                            <th className="align-right">
                              整体成交订单
                              <br />
                              成本
                            </th>
                            <th className="align-right">整体支付ROI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {childOrgs.map((child) => {
                            const childAccounts = subtreeAccounts(child.id, accounts, channel);
                            const childTotals = subtreeTotals(child.id, accounts, channel, range);
                            const childDirect = accounts.filter(
                              (account) => account.orgId === child.id && account.channel === channel,
                            ).length;
                            return (
                              <tr key={child.id}>
                                <td>
                                  <div className="org-name-cell">
                                    <span className="org-dot" />
                                    <span>{child.name}</span>
                                    <span className="tag tag-blue">三级组织</span>
                                    <span className="muted" style={{ fontSize: 11 }}>
                                      ID: {child.id.slice(-8)}
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  <button type="button" className="btn-link" onClick={() => onDrill(child.id)}>
                                    查看所有账户
                                  </button>
                                </td>
                                <td>
                                  <span className="money" title="直属账户">
                                    {childDirect}
                                  </span>
                                </td>
                                <td className="align-right money">
                                  {fmtMoney(childAccounts.reduce((sum, item) => sum + item.balance, 0))}
                                </td>
                                <td className="align-right money strong">{fmtMoney(childTotals.cost)}</td>
                                <td className="align-right money">{fmtMoney(childTotals.revenue)}</td>
                                <td className="align-right money">{fmtInt(childTotals.orders)}</td>
                                <td className="align-right money">{fmtMoney(cpaOf(childTotals))}</td>
                                <td className="align-right money">{fmtRoi(roiOf(childTotals))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="org-foot">
                        共 {childOrgs.length} 个子组织，{directAccounts.length} 个直属账户
                      </div>
                    </div>
                  ) : (
                    <div className="org-table-scroll">
                      <table className="org-grid">
                        <thead>
                          <tr>
                            <th>账户信息</th>
                            <th style={{ width: 120 }}>操作</th>
                            <th className="align-right">总余额</th>
                            <th className="align-right">整体消耗</th>
                            <th className="align-right">
                              整体成交订单
                              <br />
                              数
                            </th>
                            <th className="align-right">
                              整体成交订单
                              <br />
                              成本
                            </th>
                            <th className="align-right">整体支付ROI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {directAccounts.map((account) => {
                            const rowTotals = sumSeries(account.daily, range);
                            return (
                              <tr key={account.id}>
                                <td>
                                  <div className="org-name-cell">
                                    <span className="org-dot" />
                                    <span>{account.name}</span>
                                    <span className="muted" style={{ fontSize: 11 }}>
                                      ID: {account.id}
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  <button type="button" className="btn-link" onClick={() => onDrill(account.orgId)}>
                                    查看账户
                                  </button>
                                </td>
                                <td className="align-right money">{fmtMoney(account.balance)}</td>
                                <td className="align-right money strong">{fmtMoney(rowTotals.cost)}</td>
                                <td className="align-right money">{fmtInt(rowTotals.orders)}</td>
                                <td className="align-right money">{fmtMoney(cpaOf(rowTotals))}</td>
                                <td className="align-right money">{fmtRoi(roiOf(rowTotals))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="org-foot">共 0 个子组织，{directAccounts.length} 个直属账户</div>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
