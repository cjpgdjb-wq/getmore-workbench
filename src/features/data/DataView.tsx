import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Columns3,
  Download,
  Filter,
  Layers,
  LineChart,
  MapPin,
  Maximize2,
  Megaphone,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  X,
  Zap,
} from "lucide-react";
import {
  ACCOUNTS,
  BRAND_CAMPAIGNS,
  CAMPAIGNS,
  PRODUCTS,
  ROOT_ORG_ID,
  addTotals,
  dataHealthOf,
  netTotalsOf,
  cpaOf,
  cpmOf,
  ctrOf,
  dailyTotals,
  descenders,
  lowBalanceCount,
  orgById,
  previousRange,
  presetRange,
  roiOf,
  sumSeries,
  todayCost,
  activeTodayCount,
  type Account,
  type AccountStatus,
  type AuctionMode,
  type BrandScope,
  type Campaign,
  type CampaignStatus,
  type Channel,
  type DateRange,
  type Dimension,
  type DailyPoint,
  type Product,
  type Target,
  type Totals,
} from "../../data/mock";
import {
  downloadCsv,
  fmtDateShort,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtRoi,
  nowTime,
} from "../../lib/format";
import { Modal, Select, Sparkline, useToast } from "../../components/ui";
import { useWorkbench } from "../../state/workbench";
import { AccountTable, CampaignTable, Pagination, type AccountRow, type CampaignRow, type SortState } from "./DataTable";
import OrgOverview from "./OrgOverview";
import {
  ColumnsModal,
  DateRangePopover,
  DetailDrawer,
  EMPTY_FILTERS,
  FiltersModal,
  KpiModal,
  type KpiItem,
  type MoreFilters,
} from "./DataModals";
import {
  columnConfigKey,
  defaultColumnIds,
  findColumn,
  getColumns,
  type ColumnMeta,
} from "./columns";

type DetailTarget =
  | { kind: "account"; account: Account }
  | { kind: "campaign"; campaign: Campaign; account: Account }
  | null;

const PAGE_SIZES = [10, 20, 50];

function mergeCampaignDaily(campaigns: Campaign[]): DailyPoint[] {
  const map = new Map<
    string,
    {
      date: string;
      cost: number;
      orders: number;
      revenue: number;
      show: number;
      click: number;
      netRevenue: number;
      netOrders: number;
      refundAmount: number;
      hasNet: boolean;
    }
  >();
  for (const campaign of campaigns) {
    for (const point of campaign.daily) {
      const current = map.get(point.date) ?? {
        date: point.date,
        cost: 0,
        orders: 0,
        revenue: 0,
        show: 0,
        click: 0,
        netRevenue: 0,
        netOrders: 0,
        refundAmount: 0,
        hasNet: false,
      };
      current.cost += point.cost;
      current.orders += point.orders;
      current.revenue += point.revenue;
      current.show += point.show;
      current.click += point.click;
      if (point.netRevenue !== null && point.netRevenue !== undefined) {
        current.hasNet = true;
        current.netRevenue += point.netRevenue;
        current.netOrders += point.netOrders ?? 0;
        current.refundAmount += point.refundAmount ?? 0;
      }
      map.set(point.date, current);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => ({
      date: point.date,
      cost: point.cost,
      orders: point.orders,
      revenue: point.revenue,
      show: point.show,
      click: point.click,
      netRevenue: point.hasNet ? point.netRevenue : null,
      netOrders: point.hasNet ? point.netOrders : null,
      refundAmount: point.hasNet ? point.refundAmount : null,
      refundRate: point.hasNet && point.revenue > 0 ? point.refundAmount / point.revenue : null,
    }));
}

function loadColumnConfig(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem("getmore.column-config.v1");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

interface ProductStore {
  patches: Record<string, Partial<Product>>;
  created: Product[];
  deleted: string[];
}

const PRODUCT_STORE_KEY = "getmore.products.v1";

function loadProductStore(): ProductStore {
  try {
    const raw = localStorage.getItem(PRODUCT_STORE_KEY);
    if (!raw) return { patches: {}, created: [], deleted: [] };
    const parsed = JSON.parse(raw) as Partial<ProductStore>;
    return {
      patches: parsed.patches && typeof parsed.patches === "object" ? parsed.patches : {},
      created: Array.isArray(parsed.created) ? parsed.created : [],
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
    };
  } catch {
    return { patches: {}, created: [], deleted: [] };
  }
}

interface StoredView {
  channel: Channel;
  dim: Dimension;
  mode: AuctionMode;
  target: Target;
  brandScope: BrandScope;
  range: DateRange;
  orgScope: string | null;
}

function loadView(): Partial<StoredView> {
  try {
    const raw = localStorage.getItem("getmore.view.v1");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredView>;
    const valid: Partial<StoredView> = {};
    if (parsed.channel === "auction" || parsed.channel === "brand") valid.channel = parsed.channel;
    if (parsed.dim === "org" || parsed.dim === "account" || parsed.dim === "campaign") valid.dim = parsed.dim;
    if (parsed.mode === "全域推广" || parsed.mode === "标准推广") valid.mode = parsed.mode;
    if (parsed.target === "全部" || parsed.target === "推商品" || parsed.target === "推直播间") valid.target = parsed.target;
    if (parsed.brandScope === "整体（不含搜索）" || parsed.brandScope === "搜索") valid.brandScope = parsed.brandScope;
    if (parsed.range && typeof parsed.range.start === "string" && typeof parsed.range.end === "string") {
      valid.range = parsed.range;
    }
    if (parsed.orgScope === null || typeof parsed.orgScope === "string") valid.orgScope = parsed.orgScope;
    return valid;
  } catch {
    return {};
  }
}

function loadDensity(): "default" | "compact" {
  return localStorage.getItem("getmore.density") === "compact" ? "compact" : "default";
}

export default function DataView() {
  const toast = useToast();
  const { snapshot: _snapshot, setSnapshot, consumeAction, pendingAction, operations, setActiveTab, startPartnerTask, setPendingDraft, setPendingProductId } = useWorkbench();
  const initialView = useMemo(() => loadView(), []);

  const [channel, setChannel] = useState<Channel>(initialView.channel ?? "auction");
  const [mode, setMode] = useState<AuctionMode>(initialView.mode ?? "全域推广");
  const [target, setTarget] = useState<Target>(initialView.target ?? "全部");
  const [brandScope, setBrandScope] = useState<BrandScope>(initialView.brandScope ?? "整体（不含搜索）");
  const [dim, setDim] = useState<Dimension>(initialView.dim ?? "account");
  const [range, setRange] = useState<DateRange>(() => initialView.range ?? presetRange("last7"));
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<"抖音号" | "商品" | "计划">("抖音号");
  const [quick, setQuick] = useState("all");
  const [sort, setSort] = useState<SortState>({ key: "cost", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersDraft, setFiltersDraft] = useState<MoreFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<MoreFilters>(EMPTY_FILTERS);
  const [orgScope, setOrgScope] = useState<string | null>(initialView.orgScope ?? null);
  const [columnConfig, setColumnConfig] = useState<Record<string, string[]>>(loadColumnConfig);
  const [density, setDensity] = useState<"default" | "compact">(loadDensity);
  const [modal, setModal] = useState<null | "columns" | "filters" | "kpi">(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [columnsMenu, setColumnsMenu] = useState(false);
  const [kpiMenu, setKpiMenu] = useState(false);
  const [hiddenKpi, setHiddenKpi] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<DetailTarget>(null);
  const [accountPatch, setAccountPatch] = useState<Record<string, Partial<Pick<Account, "status" | "followed">>>>({});
  const [campaignPatch, setCampaignPatch] = useState<Record<string, CampaignStatus>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(nowTime());
  const [healthOpen, setHealthOpen] = useState(false);
  const [productStore, setProductStore] = useState<ProductStore>(loadProductStore);

  const prevRange = useMemo(() => previousRange(range), [range]);

  useEffect(() => {
    try {
      localStorage.setItem(PRODUCT_STORE_KEY, JSON.stringify(productStore));
    } catch {
      /* storage full / privacy mode */
    }
  }, [productStore]);

  const products = useMemo(() => {
    const base = PRODUCTS.filter((product) => !productStore.deleted.includes(product.id)).map((product) => ({
      ...product,
      ...(productStore.patches[product.id] ?? {}),
    }));
    const created = productStore.created
      .filter((product) => !productStore.deleted.includes(product.id))
      .map((product) => ({ ...product, ...(productStore.patches[product.id] ?? {}) }));
    return [...base, ...created];
  }, [productStore]);

  const resolveProduct = useCallback((id: string) => products.find((product) => product.id === id), [products]);

  /* ---------------- Accounts / campaigns with local + agent mutations ---------------- */

  const accountOperations = useMemo(() => {
    const map = new Map<string, Partial<Pick<Account, "status" | "budget">>>();
    for (const operation of [...operations].reverse()) {
      if (operation.undone || operation.target_type !== "account") continue;
      const patch = map.get(operation.target_id) ?? {};
      if (operation.field === "status") patch.status = operation.after as AccountStatus;
      if (operation.field === "budget") patch.budget = Number(operation.after);
      map.set(operation.target_id, patch);
    }
    return map;
  }, [operations]);

  const campaignOperations = useMemo(() => {
    const map = new Map<string, Partial<Pick<Campaign, "status" | "budget" | "bid">>>();
    for (const operation of [...operations].reverse()) {
      if (operation.undone || operation.target_type !== "plan") continue;
      const patch = map.get(operation.target_id) ?? {};
      if (operation.field === "status") patch.status = operation.after as CampaignStatus;
      if (operation.field === "budget") patch.budget = Number(operation.after);
      if (operation.field === "bid") patch.bid = Number(operation.after);
      map.set(operation.target_id, patch);
    }
    return map;
  }, [operations]);

  const activeOperations = useMemo(() => operations.filter((operation) => !operation.undone), [operations]);
  const agentAccountIds = useMemo(
    () => new Set(activeOperations.filter((operation) => operation.target_type === "account").map((operation) => operation.target_id)),
    [activeOperations],
  );
  const agentPlanIds = useMemo(
    () => new Set(activeOperations.filter((operation) => operation.target_type === "plan").map((operation) => operation.target_id)),
    [activeOperations],
  );
  const productCounts = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const product of products) {
      const set = map.get(product.accountId) ?? new Set<string>();
      set.add(product.id);
      map.set(product.accountId, set);
    }
    return new Map(Array.from(map.entries()).map(([accountId, set]) => [accountId, set.size]));
  }, [products]);

  const decoratedAccounts = useMemo(
    () =>
      ACCOUNTS.filter((account) => account.channel === channel).map((account) => {
        const patch = accountPatch[account.id];
        const agentPatch = accountOperations.get(account.id);
        return { ...account, ...(patch ?? {}), ...(agentPatch ?? {}) };
      }),
    [channel, accountPatch, accountOperations],
  );

  const decoratedCampaigns = useMemo(() => {
    const source = channel === "auction" ? CAMPAIGNS : BRAND_CAMPAIGNS;
    return source.map((campaign) => {
      const manual = campaignPatch[campaign.id];
      const agent = campaignOperations.get(campaign.id);
      if (!manual && !agent) return campaign;
      return {
        ...campaign,
        ...(manual ? { status: manual } : {}),
        ...(agent ?? {}),
      };
    });
  }, [channel, campaignPatch, campaignOperations]);

  const scopedAccounts = decoratedAccounts;
  const scopedCampaigns = decoratedCampaigns;

  const sliceCampaigns = useMemo(
    () =>
      channel === "auction"
        ? scopedCampaigns.filter(
            (campaign) => campaign.mode === mode && (target === "全部" || campaign.target === target),
          )
        : scopedCampaigns.filter((campaign) =>
            brandScope === "搜索"
              ? campaign.brandPlacement === "品牌搜索"
              : campaign.brandPlacement !== "品牌搜索",
          ),
    [channel, scopedCampaigns, mode, target, brandScope],
  );

  const sliceAccounts = useMemo(
    () =>
      scopedAccounts.flatMap((account) => {
        const list = sliceCampaigns.filter((campaign) => campaign.accountId === account.id);
        if (list.length === 0) return [];
        return [{ ...account, daily: mergeCampaignDaily(list) }];
      }),
    [scopedAccounts, sliceCampaigns],
  );

  const filteredAccounts = useMemo(() => {
    let list = sliceAccounts;
    if (orgScope) {
      const orgIds = new Set(descenders(orgScope));
      list = list.filter((account) => orgIds.has(account.orgId));
    }
    if (dim === "account") {
      const query = search.trim().toLowerCase();
      if (query) {
        list = list.filter(
          (account) =>
            account.name.toLowerCase().includes(query) ||
            account.id.includes(query) ||
            account.remark.toLowerCase().includes(query),
        );
      }
      if (quick === "followed") list = list.filter((account) => account.followed);
      if (quick === "lowbalance") list = list.filter((account) => account.balance < 5000);
      if (quick === "paused") list = list.filter((account) => account.status !== "投放中");
      const costValue = Number(filters.costValue);
      if (filters.costOp && filters.costValue !== "" && Number.isFinite(costValue)) {
        list = list.filter((account) => {
          const cost = sumSeries(account.daily, range).cost;
          return filters.costOp === "gte" ? cost >= costValue : cost <= costValue;
        });
      }
      const balanceValue = Number(filters.balanceValue);
      if (filters.balanceOp && filters.balanceValue !== "" && Number.isFinite(balanceValue)) {
        list = list.filter((account) =>
          filters.balanceOp === "gte" ? account.balance >= balanceValue : account.balance <= balanceValue,
        );
      }
    }
    return list;
  }, [sliceAccounts, orgScope, dim, search, quick, filters, range]);

  const accountByIdMap = useMemo(() => new Map(scopedAccounts.map((account) => [account.id, account])), [scopedAccounts]);

  const filteredCampaigns = useMemo(() => {
    let list = sliceCampaigns;
    if (orgScope) {
      const orgIds = new Set(descenders(orgScope));
      list = list.filter((campaign) => {
        const account = accountByIdMap.get(campaign.accountId);
        return account ? orgIds.has(account.orgId) : false;
      });
    }
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((campaign) => {
        if (searchField === "抖音号") return campaign.douyinId.includes(query);
        if (searchField === "商品") return (resolveProduct(campaign.productId)?.name ?? "").toLowerCase().includes(query);
        return campaign.name.toLowerCase().includes(query);
      });
    }
    return list;
  }, [sliceCampaigns, orgScope, accountByIdMap, search, searchField, resolveProduct]);

  const accountRows = useMemo<AccountRow[]>(
    () =>
      filteredAccounts.map((account) => ({
        account,
        totals: sumSeries(account.daily, range),
        prev: sumSeries(account.daily, prevRange),
      })),
    [filteredAccounts, range, prevRange],
  );

  const campaignRows = useMemo<CampaignRow[]>(
    () =>
      filteredCampaigns.flatMap((campaign) => {
        const account = accountByIdMap.get(campaign.accountId);
        if (!account) return [];
        return [{ campaign, account, totals: sumSeries(campaign.daily, range), prev: sumSeries(campaign.daily, prevRange) }];
      }),
    [filteredCampaigns, accountByIdMap, range, prevRange],
  );

  const sortValue = useCallback(
    (row: AccountRow | CampaignRow): number => {
      if ("account" in row && !("campaign" in row)) {
        const accountRow = row as AccountRow;
        switch (sort.key) {
          case "cost":
            return accountRow.totals.cost;
          case "roi":
            return roiOf(accountRow.totals) ?? -1;
          case "payAmount":
            return accountRow.totals.revenue;
          case "orders":
            return accountRow.totals.orders;
          case "cpa":
            return cpaOf(accountRow.totals) ?? Number.MAX_SAFE_INTEGER;
          case "balance":
            return accountRow.account.balance;
          case "bidBalance":
            return accountRow.account.balance * 0.82;
          case "budget":
            return accountRow.account.budget;
          case "shows":
            return accountRow.totals.show;
          case "clicks":
            return accountRow.totals.click;
          case "ctr":
            return ctrOf(accountRow.totals) ?? 0;
          case "cpm":
            return cpmOf(accountRow.totals) ?? 0;
          default:
            return accountRow.totals.cost;
        }
      }
      const campaignRow = row as CampaignRow;
      switch (sort.key) {
        case "cost":
          return campaignRow.totals.cost;
        case "roi":
          return roiOf(campaignRow.totals) ?? -1;
        case "payAmount":
          return campaignRow.totals.revenue;
        case "orders":
          return campaignRow.totals.orders;
        case "cpa":
          return cpaOf(campaignRow.totals) ?? Number.MAX_SAFE_INTEGER;
        case "budget":
          return campaignRow.campaign.budget;
        case "bid":
          return campaignRow.campaign.bid;
        case "shows":
          return campaignRow.totals.show;
        case "clicks":
          return campaignRow.totals.click;
        case "ctr":
          return ctrOf(campaignRow.totals) ?? 0;
        case "cpm":
          return cpmOf(campaignRow.totals) ?? 0;
        default:
          return campaignRow.totals.cost;
      }
    },
    [sort.key],
  );

  const sortedAccountRows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...accountRows].sort((a, b) => (sortValue(a) - sortValue(b)) * dir);
  }, [accountRows, sort.dir, sortValue]);

  const sortedCampaignRows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...campaignRows].sort((a, b) => (sortValue(a) - sortValue(b)) * dir);
  }, [campaignRows, sort.dir, sortValue]);

  const totalRows = dim === "account" ? sortedAccountRows.length : dim === "campaign" ? sortedCampaignRows.length : 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, pageCount);

  const pagedAccountRows = useMemo(
    () => sortedAccountRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedAccountRows, safePage, pageSize],
  );
  const pagedCampaignRows = useMemo(
    () => sortedCampaignRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedCampaignRows, safePage, pageSize],
  );

  const currentIds = useMemo(
    () =>
      dim === "account"
        ? sortedAccountRows.map((row) => row.account.id)
        : sortedCampaignRows.map((row) => row.campaign.id),
    [dim, sortedAccountRows, sortedCampaignRows],
  );

  const orgChildCount = useMemo(() => {
    const root = orgById(orgScope ?? ROOT_ORG_ID);
    return (root?.children ?? []).filter((orgId) => {
      const orgIds = new Set(descenders(orgId));
      return sliceAccounts.some((account) => orgIds.has(account.orgId));
    }).length;
  }, [orgScope, sliceAccounts]);

  const orgSummaries = useMemo(() => {
    const root = orgById(orgScope ?? ROOT_ORG_ID);
    if (!root) return [];
    return root.children
      .map((orgId) => {
        const orgIds = new Set(descenders(orgId));
        const accounts = sliceAccounts.filter((account) => orgIds.has(account.orgId));
        if (!accounts.length) return null;
        const totals = addTotals(accounts.map((account) => sumSeries(account.daily, range)));
        return {
          name: orgById(orgId)?.name ?? orgId,
          accounts: accounts.length,
          cost: totals.cost,
          revenue: totals.revenue,
          orders: totals.orders,
          roi: roiOf(totals),
          cpa: cpaOf(totals),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [orgScope, sliceAccounts, range]);

  /* ---------------- KPI ---------------- */

  const kpiTotals = useMemo(
    () => addTotals(sliceAccounts.map((account) => sumSeries(account.daily, range))),
    [sliceAccounts, range],
  );
  const kpiPrevTotals = useMemo(
    () => addTotals(sliceAccounts.map((account) => sumSeries(account.daily, prevRange))),
    [sliceAccounts, prevRange],
  );
  const kpiDaily = useMemo(
    () => dailyTotals(sliceAccounts.map((account) => account.daily), range),
    [sliceAccounts, range],
  );
  const kpiLabels = kpiDaily.map((item) => item.date);

  const kpis = useMemo<KpiItem[]>(() => {
    const costDelta = roiOf(kpiTotals);
    const prevCostDelta = roiOf(kpiPrevTotals);
    const dailyRoi = kpiDaily.map((item) => (item.totals.cost > 0 ? item.totals.revenue / item.totals.cost : 0));
    const dailyCpa = kpiDaily.map((item) => (item.totals.orders > 0 ? item.totals.cost / item.totals.orders : 0));
    const dailyCtr = kpiDaily.map((item) => (item.totals.show > 0 ? (item.totals.click / item.totals.show) * 100 : 0));
    const dailyCpm = kpiDaily.map((item) => (item.totals.show > 0 ? (item.totals.cost / item.totals.show) * 1000 : 0));

    if (channel === "auction") {
      return [
        {
          key: "cost",
          label: "整体消耗",
          value: kpiTotals.cost,
          prev: kpiPrevTotals.cost,
          format: (value) => fmtMoney(value),
          unit: "元",
          spark: kpiDaily.map((item) => item.totals.cost),
        },
        {
          key: "orders",
          label: "整体成交订单数",
          value: kpiTotals.orders,
          prev: kpiPrevTotals.orders,
          format: (value) => fmtInt(value),
          unit: "单",
          spark: kpiDaily.map((item) => item.totals.orders),
        },
        {
          key: "revenue",
          label: "用户实际支付金额",
          value: kpiTotals.revenue,
          prev: kpiPrevTotals.revenue,
          format: (value) => fmtMoney(value),
          unit: "元",
          spark: kpiDaily.map((item) => item.totals.revenue),
        },
        {
          key: "roi",
          label: "整体支付ROI",
          value: costDelta,
          prev: prevCostDelta,
          format: (value) => fmtRoi(value),
          spark: dailyRoi,
          hint: "支付金额 / 消耗",
        },
        {
          key: "cpa",
          label: "整体成交订单成本",
          value: cpaOf(kpiTotals),
          prev: cpaOf(kpiPrevTotals),
          format: (value) => fmtMoney(value),
          unit: "元",
          spark: dailyCpa,
        },
      ];
    }

    return [
      {
        key: "cost",
        label: "消耗",
        value: kpiTotals.cost,
        prev: kpiPrevTotals.cost,
        format: (value) => fmtMoney(value),
        unit: "元",
        spark: kpiDaily.map((item) => item.totals.cost),
      },
      {
        key: "shows",
        label: "展示次数",
        value: kpiTotals.show,
        prev: kpiPrevTotals.show,
        format: (value) => fmtInt(value),
        unit: "次",
        spark: kpiDaily.map((item) => item.totals.show),
      },
      {
        key: "cpm",
        label: "平均千次展现费用",
        value: cpmOf(kpiTotals),
        prev: cpmOf(kpiPrevTotals),
        format: (value) => fmtMoney(value),
        unit: "元",
        spark: dailyCpm,
      },
      {
        key: "clicks",
        label: "点击次数",
        value: kpiTotals.click,
        prev: kpiPrevTotals.click,
        format: (value) => fmtInt(value),
        unit: "次",
        spark: kpiDaily.map((item) => item.totals.click),
      },
      {
        key: "ctr",
        label: "点击率",
        value: ctrOf(kpiTotals),
        prev: ctrOf(kpiPrevTotals),
        format: (value) => fmtPct(value),
        spark: dailyCtr,
      },
    ];
  }, [channel, kpiTotals, kpiPrevTotals, kpiDaily]);

  const visibleKpis = useMemo(() => kpis.filter((item) => !hiddenKpi.includes(item.key)), [kpis, hiddenKpi]);

  const breakdownCampaigns = useMemo(() => {
    if (!orgScope) return scopedCampaigns;
    const orgIds = new Set(descenders(orgScope));
    return scopedCampaigns.filter((campaign) => {
      const account = accountByIdMap.get(campaign.accountId);
      return account ? orgIds.has(account.orgId) : false;
    });
  }, [scopedCampaigns, orgScope, accountByIdMap]);

  const buildBreakdown = useCallback(
    (keyOf: (campaign: Campaign) => string, order: string[]) => {
      const groups = new Map<
        string,
        {
          cost: number;
          revenue: number;
          orders: number;
          plans: number;
          accounts: Set<string>;
          netRevenue: number;
          netOrders: number;
          refundAmount: number;
          hasNet: boolean;
        }
      >();
      let totalCost = 0;
      for (const campaign of breakdownCampaigns) {
        const account = accountByIdMap.get(campaign.accountId);
        if (!account) continue;
        const totals = sumSeries(campaign.daily, range);
        const net = netTotalsOf(
          campaign.daily.filter((point) => point.date >= range.start && point.date <= range.end),
        );
        const key = keyOf(campaign);
        const group = groups.get(key) ?? {
          cost: 0,
          revenue: 0,
          orders: 0,
          plans: 0,
          accounts: new Set<string>(),
          netRevenue: 0,
          netOrders: 0,
          refundAmount: 0,
          hasNet: false,
        };
        group.cost += totals.cost;
        group.revenue += totals.revenue;
        group.orders += totals.orders;
        group.plans += 1;
        group.accounts.add(account.id);
        if (net.netRevenue !== null) {
          group.hasNet = true;
          group.netRevenue += net.netRevenue;
          group.netOrders += net.netOrders ?? 0;
          group.refundAmount += net.refundAmount ?? 0;
        }
        groups.set(key, group);
        totalCost += totals.cost;
      }
      return order
        .filter((key) => groups.has(key))
        .map((key) => {
          const group = groups.get(key)!;
          const roi = group.cost > 0 ? group.revenue / group.cost : null;
          return {
            key,
            label: key,
            cost: group.cost,
            revenue: group.revenue,
            orders: group.orders,
            netRevenue: group.hasNet ? group.netRevenue : null,
            netRoi: group.hasNet && group.cost > 0 ? group.netRevenue / group.cost : null,
            refundRate: group.hasNet && group.revenue > 0 ? group.refundAmount / group.revenue : null,
            roi,
            cpa: group.orders > 0 ? group.cost / group.orders : null,
            plans: group.plans,
            accounts: group.accounts.size,
            share: totalCost > 0 ? group.cost / totalCost : 0,
          };
        });
    },
    [breakdownCampaigns, accountByIdMap, range],
  );

  const modeBreakdown = useMemo(
    () => buildBreakdown((campaign) => campaign.mode, ["全域推广", "标准推广", "品牌预定单"]),
    [buildBreakdown],
  );
  const targetBreakdown = useMemo(
    () => buildBreakdown((campaign) => campaign.target, ["推商品", "推直播间"]),
    [buildBreakdown],
  );

  const dataHealth = useMemo(() => {
    const list = sliceAccounts.map(dataHealthOf);
    const missing = Array.from(new Set(list.flatMap((item) => item.missing)));
    const completeness = list.length
      ? list.reduce((total, item) => total + item.completeness, 0) / list.length
      : 0;
    const lastSyncedAt = sliceAccounts
      .map((account) => account.lastSyncedAt)
      .sort()
      .at(-1) ?? "--";
    return {
      completeness,
      lastSyncedAt,
      lagMinutes: sliceAccounts.reduce((max, account) => Math.max(max, account.dataLagMinutes), 0),
      missing,
      staleAccounts: list.filter((item) => item.stale.length > 0).length,
      partialAccounts: list.filter((item) => item.authorization !== "已授权").length,
      totalAccounts: list.length,
    };
  }, [sliceAccounts]);

  const accountHealthRows = useMemo(
    () => sliceAccounts.map((account) => ({ account, health: dataHealthOf(account) })),
    [sliceAccounts],
  );

  /* ---------------- Table columns ---------------- */

  const columnKey = columnConfigKey(channel, dim);
  const visibleColumnIds = columnConfig[columnKey] ?? defaultColumnIds(channel, dim);
  const visibleColumns = useMemo(
    () =>
      visibleColumnIds
        .map((id) => findColumn(channel, dim, id))
        .filter((column): column is ColumnMeta => Boolean(column)),
    [visibleColumnIds, channel, dim],
  );

  const handleSaveColumns = (ids: string[]) => {
    const next = { ...columnConfig, [columnKey]: ids };
    setColumnConfig(next);
    try {
      localStorage.setItem("getmore.column-config.v1", JSON.stringify(next));
    } catch {
      /* ignore quota errors */
    }
    setModal(null);
    toast("列配置已保存", "success");
  };

  const changeDensity = (next: "default" | "compact") => {
    setDensity(next);
    try {
      localStorage.setItem("getmore.density", next);
    } catch {
      /* ignore */
    }
    setColumnsMenu(false);
  };

  /* ---------------- Effects ---------------- */

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 260);
    return () => window.clearTimeout(timer);
  }, [channel, dim, range.start, range.end]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "getmore.view.v1",
        JSON.stringify({ channel, dim, mode, target, brandScope, range, orgScope }),
      );
    } catch {
      /* ignore storage errors */
    }
  }, [channel, dim, mode, target, brandScope, range, orgScope]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [channel, dim, range.start, range.end, search, quick, filters, mode, target, brandScope, orgScope]);

  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(currentIds);
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [currentIds]);

  useEffect(() => {
    if (!pendingAction) return;
    const action = consumeAction();
    if (!action) return;
    switch (action.type) {
      case "set_channel": {
        setChannel(action.channel);
        setDim("account");
        setSearch("");
        setQuick("all");
        setFilters(EMPTY_FILTERS);
        setOrgScope(null);
        toast(`Copilot 已切换到${action.channel === "auction" ? "竞价投放" : "品牌投放"}`, "success");
        break;
      }
      case "set_dimension": {
        setDim(action.dimension);
        setOrgScope(null);
        toast("Copilot 已切换看板维度", "success");
        break;
      }
      case "set_mode": {
        setChannel("auction");
        setMode(action.mode);
        setPage(1);
        toast(`Copilot 已切换到${action.mode}`, "success");
        break;
      }
      case "set_target": {
        setChannel("auction");
        setTarget(action.target);
        setPage(1);
        toast(`Copilot 已切换推广目标为${action.target === "全部" ? "全部" : action.target}`, "success");
        break;
      }
      case "set_range": {
        setRange(presetRange(action.preset));
        toast("Copilot 已更新统计周期", "success");
        break;
      }
      case "set_search": {
        setSearch(action.query);
        toast(`Copilot 已搜索「${action.query}」`, "success");
        break;
      }
      case "filter_low_balance": {
        setDim("account");
        setQuick("lowbalance");
        toast("Copilot 已筛选余额不足账户", "success");
        break;
      }
      case "open_account": {
        const account = decoratedAccounts.find((item) => item.id === action.accountId)
          ?? ACCOUNTS.find((item) => item.id === action.accountId);
        if (account) {
          if (account.channel !== channel) {
            setChannel(account.channel);
            setOrgScope(null);
          }
          setDrawer({ kind: "account", account });
          toast(`已打开 ${account.name}`, "success");
        }
        break;
      }
      default:
        break;
    }
  }, [pendingAction, consumeAction, scopedAccounts, toast]);

  useEffect(() => {
    const top = [...accountRows].sort((a, b) => b.totals.cost - a.totals.cost).slice(0, 3);
    setSnapshot({
      channel,
      dimension: dim,
      dimensionLabel: dim === "org" ? "组织总览" : dim === "account" ? "账户" : channel === "auction" ? "推广计划" : "品牌计划",
      range,
      mode: channel === "auction" ? mode : brandScope,
      target: channel === "auction" ? target : "推商品",
      orgName: orgScope ? (orgById(orgScope)?.name ?? null) : null,
      search,
      rowCount: dim === "org" ? orgSummaries.length : totalRows,
      totalCount: sliceAccounts.length,
      selectedCount: selected.size,
      kpi: visibleKpis.map((item) => ({ label: item.label, value: `${item.format(item.value)}${item.unit ?? ""}` })),
      orgs: orgSummaries,
      topAccounts: top.map((row) => ({
        id: row.account.id,
        name: row.account.name,
        cost: row.totals.cost,
        roi: roiOf(row.totals),
        metric:
          channel === "auction"
            ? `ROI ${fmtRoi(roiOf(row.totals))}`
            : `CPM ${fmtMoney(cpmOf(row.totals))}`,
      })),
      dataHealth,
      breakdowns: { modes: modeBreakdown, targets: targetBreakdown },
      updatedAt,
    });
  }, [
    channel,
    dim,
    mode,
    target,
    brandScope,
    range,
    orgScope,
    search,
    totalRows,
    orgSummaries,
    sliceAccounts.length,
    selected.size,
    visibleKpis,
    accountRows,
    dataHealth,
    modeBreakdown,
    targetBreakdown,
    updatedAt,
    setSnapshot,
  ]);

  /* ---------------- Handlers ---------------- */

  const switchChannel = (next: Channel) => {
    if (next === channel) return;
    setChannel(next);
    setDim("account");
    setOrgScope(null);
    setSearch("");
    setQuick("all");
    setFilters(EMPTY_FILTERS);
    setSort({ key: "cost", dir: "desc" });
    setUpdatedAt(nowTime());
  };

  const switchDim = (next: Dimension) => {
    if (next === dim) return;
    setDim(next);
    setSearch("");
    setQuick("all");
    setFilters(EMPTY_FILTERS);
    setSort({ key: "cost", dir: "desc" });
    setOrgScope(null);
  };

  const handleSort = (key: string) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  };

  const handleSelect = (id: string, next: boolean) => {
    setSelected((prev) => {
      const set = new Set(prev);
      if (next) set.add(id);
      else set.delete(id);
      return set;
    });
  };

  const pageIds = dim === "account" ? pagedAccountRows.map((row) => row.account.id) : pagedCampaignRows.map((row) => row.campaign.id);
  const handleSelectAll = (next: boolean) => {
    setSelected((prev) => {
      const set = new Set(prev);
      pageIds.forEach((id) => (next ? set.add(id) : set.delete(id)));
      return set;
    });
  };

  const saveProduct = (product: Product) => {
    setProductStore((prev) => {
      const isBase = PRODUCTS.some((item) => item.id === product.id);
      const isCreated = prev.created.some((item) => item.id === product.id);
      const deleted = prev.deleted.filter((id) => id !== product.id);
      if (isBase || isCreated) {
        return { ...prev, deleted, patches: { ...prev.patches, [product.id]: product } };
      }
      return { ...prev, deleted, created: [...prev.created, product] };
    });
    toast("商品已保存", "success");
  };

  const deleteProduct = (product: Product) => {
    const hasPlans = [...CAMPAIGNS, ...BRAND_CAMPAIGNS].some((campaign) => campaign.productId === product.id);
    if (hasPlans) {
      toast("该商品仍有推广计划，请先处理计划再删除", "warn");
      return;
    }
    setProductStore((prev) => ({
      ...prev,
      created: prev.created.filter((item) => item.id !== product.id),
      deleted: Array.from(new Set([...prev.deleted, product.id])),
    }));
    toast(`已删除商品「${product.name}」`, "success");
  };

  const toggleFollow = (account: Account) => {
    const next = !scopedAccounts.find((item) => item.id === account.id)?.followed;
    setAccountPatch((prev) => ({ ...prev, [account.id]: { ...prev[account.id], followed: next } }));
    toast(next ? `已关注 ${account.name}` : `已取消关注 ${account.name}`, next ? "success" : "info");
  };

  const toggleCampaign = (campaign: Campaign, next: boolean) => {
    setCampaignPatch((prev) => ({ ...prev, [campaign.id]: next ? "投放中" : "已暂停" }));
    toast(`${campaign.name} 已${next ? "开启" : "暂停"}`, next ? "success" : "info");
  };

  const batchSetStatus = (status: "投放中" | "已暂停") => {
    if (selected.size === 0) return;
    if (dim === "account") {
      setAccountPatch((prev) => {
        const next = { ...prev };
        selected.forEach((id) => {
          next[id] = { ...next[id], status: status as AccountStatus };
        });
        return next;
      });
    } else if (dim === "campaign") {
      setCampaignPatch((prev) => {
        const next = { ...prev };
        selected.forEach((id) => {
          next[id] = status as CampaignStatus;
        });
        return next;
      });
    }
    toast(`已${status === "投放中" ? "开启" : "暂停"} ${selected.size} 个${dim === "account" ? "账户" : "推广"}`, "success");
    setSelected(new Set());
  };

  const runRefresh = () => {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setUpdatedAt(nowTime());
      toast("数据已刷新（本地模拟）", "success");
    }, 600);
  };

  const exportCsv = () => {
    if (dim === "account") {
      const header = ["账户名称", "账户ID", ...visibleColumns.map((column) => `${column.label}${column.sub ?? ""}`)];
      const rows = sortedAccountRows.map((row) => {
        const values = visibleColumns.map((column) => {
          switch (column.id) {
            case "status":
              return row.account.status;
            case "role":
              return row.account.role;
            case "budget":
              return row.account.budget.toFixed(2);
            case "balance":
              return row.account.balance.toFixed(2);
            case "bidBalance":
              return (row.account.balance * 0.82).toFixed(2);
            case "org":
              return orgById(row.account.orgId)?.name ?? "";
            case "remark":
              return row.account.remark;
            case "cost":
              return row.totals.cost.toFixed(2);
            case "roi":
              return (roiOf(row.totals) ?? 0).toFixed(2);
            case "payAmount":
              return row.totals.revenue.toFixed(2);
            case "orders":
              return row.totals.orders;
            case "cpa":
              return (cpaOf(row.totals) ?? 0).toFixed(2);
            case "shows":
              return row.totals.show;
            case "clicks":
              return row.totals.click;
            case "ctr":
              return (ctrOf(row.totals) ?? 0).toFixed(2);
            case "cpm":
              return (cpmOf(row.totals) ?? 0).toFixed(2);
            default:
              return "";
          }
        });
        return [row.account.name, row.account.id, ...values];
      });
      downloadCsv(`GETmore-账户数据-${range.start}-${range.end}.csv`, [header, ...rows]);
    } else if (dim === "campaign") {
      const header = ["计划名称", "计划ID", ...visibleColumns.map((column) => `${column.label}${column.sub ?? ""}`)];
      const rows = sortedCampaignRows.map((row) => {
        const values = visibleColumns.map((column) => {
          switch (column.id) {
            case "cost":
              return row.totals.cost.toFixed(2);
            case "roi":
              return (roiOf(row.totals) ?? 0).toFixed(2);
            case "payAmount":
              return row.totals.revenue.toFixed(2);
            case "orders":
              return row.totals.orders;
            case "cpa":
              return (cpaOf(row.totals) ?? 0).toFixed(2);
            case "shows":
              return row.totals.show;
            case "clicks":
              return row.totals.click;
            case "ctr":
              return (ctrOf(row.totals) ?? 0).toFixed(2);
            case "cpm":
              return (cpmOf(row.totals) ?? 0).toFixed(2);
            case "product":
              return resolveProduct(row.campaign.productId)?.name ?? "--";
            case "douyin":
              return row.campaign.douyinId;
            case "account":
              return row.account.name;
            case "budget":
              return row.campaign.budget.toFixed(2);
            case "bid":
              return row.campaign.bid.toFixed(2);
            case "status":
              return row.campaign.status;
            default:
              return "";
          }
        });
        return [row.campaign.name, row.campaign.id, ...values];
      });
      downloadCsv(`GETmore-推广数据-${range.start}-${range.end}.csv`, [header, ...rows]);
    }
    toast("已导出当前筛选结果", "success");
  };

  /* ---------------- Render helpers ---------------- */

  const activeFilterCount =
    (filters.costOp && filters.costValue ? 1 : 0) + (filters.balanceOp && filters.balanceValue ? 1 : 0);

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setFiltersDraft(EMPTY_FILTERS);
    setQuick("all");
    setSearch("");
    setOrgScope(null);
  };

  const quickOptions =
    channel === "auction"
      ? [
          { value: "all", label: "全部" },
          { value: "followed", label: "已关注" },
          { value: "lowbalance", label: "余额不足" },
          { value: "paused", label: "已暂停" },
        ]
      : [
          { value: "all", label: "全部" },
          { value: "followed", label: "已关注" },
          { value: "lowbalance", label: "余额不足" },
        ];

  const tabDefs =
    channel === "auction"
      ? [
          { id: "org" as const, label: "组织总览", count: orgChildCount },
          { id: "account" as const, label: "账户", count: sliceAccounts.length },
          { id: "campaign" as const, label: "推广计划", count: filteredCampaigns.length },
        ]
      : [
          { id: "org" as const, label: "组织总览", count: orgChildCount },
          { id: "account" as const, label: "账户", count: sliceAccounts.length },
          { id: "campaign" as const, label: "品牌计划", count: filteredCampaigns.length },
        ];

  const placeholder =
    dim === "org" ? "请输入组织名称、ID" : dim === "account" ? "请输入账户名称、ID、备注" : `请输入${searchField}`;

  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;

  return (
    <div className="data-view">
      <aside className="app-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-caption">广告平台</div>
          <div className="side-group">
            <Megaphone size={16} />
            巨量广告
            <ChevronDown size={13} className="chev" />
          </div>
          <div className="side-group is-expanded is-active">
            <Zap size={16} />
            巨量千川
            <ChevronDown size={13} className="chev" />
          </div>
          <div className="side-sub">
            <button
              type="button"
              className={`side-item ${channel === "auction" ? "is-active" : ""}`}
              onClick={() => switchChannel("auction")}
            >
              竞价广告
              <span className="side-badge">{ACCOUNTS.filter((item) => item.channel === "auction").length} 账户</span>
            </button>
            <button
              type="button"
              className={`side-item ${channel === "brand" ? "is-active" : ""}`}
              onClick={() => switchChannel("brand")}
            >
              品牌广告
              <span className="side-badge">{ACCOUNTS.filter((item) => item.channel === "brand").length} 账户</span>
            </button>
          </div>
          <div className="side-group">
            <MapPin size={16} />
            巨量本地推
          </div>
          <div className="side-group">
            <Star size={16} />
            巨量星图
          </div>
        </div>
        <div className="sidebar-foot">
          <div className="sidebar-tip">
            <Sparkles size={14} className="tip-icon" />
            <span>接入 GETmore Copilot，用自然语言诊断账户、复盘投放、生成经营周报。</span>
          </div>
        </div>
      </aside>

      <main className="data-main">
        <div className="data-page-head">
          <div className="data-page-title">
            多账户投放看板
            <span className="env">模拟数据</span>
          </div>
          <div className="data-page-sub">
            巨量千川 · {channel === "auction" ? "竞价广告" : "品牌广告"} · 统一查看全部账户 / 项目 / 单元
          </div>
          <div className="data-page-actions">
            {orgScope && (
              <button type="button" className="org-filter-tag" onClick={() => setOrgScope(null)}>
                <Layers size={12} /> {orgById(orgScope)?.name} <X size={12} />
              </button>
            )}
            <span className="update-time">
              <CalendarDays size={12} /> 更新于 {updatedAt}
            </span>
            <button
              type="button"
              className={`health-chip ${dataHealth.completeness >= 0.85 ? "ok" : dataHealth.completeness >= 0.65 ? "warn" : "bad"}`}
              onClick={() => setHealthOpen(true)}
              title="查看数据完整性、延迟和授权状态"
            >
              <span className="health-dot" />
              数据健康 {Math.round(dataHealth.completeness * 100)}%
            </button>
            <button type="button" className="btn btn-default btn-sm" onClick={runRefresh}>
              <RefreshCw size={13} className={loading ? "spin" : ""} /> 刷新
            </button>
          </div>
        </div>

        {activeOperations.length > 0 && (
          <div className="data-agent-strip">
            <Sparkles size={13} />
            <span className="strip-label">Agent 最近操作</span>
            <div className="strip-ops">
              {activeOperations.slice(0, 3).map((operation) => (
                <span className="strip-op" key={operation.id}>
                  {operation.target_name} · {operation.field === "budget" ? "预算" : operation.field === "bid" ? "出价" : "状态"}{" "}
                  {operation.field === "status" ? operation.before : fmtMoney(Number(operation.before))} →{" "}
                  {operation.field === "status" ? operation.after : fmtMoney(Number(operation.after))}
                </span>
              ))}
              {activeOperations.length > 3 && <span className="strip-op">+{activeOperations.length - 3}</span>}
            </div>
            <button type="button" className="btn-link" onClick={() => setActiveTab("partner")}>
              查看详情
            </button>
          </div>
        )}

        <section className="data-card">
          {/* business bar */}
          <div className="biz-bar">
            {channel === "auction" ? (
              <>
                <Select
                  value={mode}
                  options={[
                    { value: "全域推广", label: "全域推广" },
                    { value: "标准推广", label: "标准推广" },
                  ]}
                  onChange={(value) => setMode(value as AuctionMode)}
                  variant="bare"
                  ariaLabel="投放方式"
                />
                <span className="biz-sep" />
                <Select
                  value={target}
                  options={[
                    { value: "全部", label: "全部" },
                    { value: "推商品", label: "推商品" },
                    { value: "推直播间", label: "推直播间" },
                  ]}
                  onChange={(value) => setTarget(value as Target)}
                  variant="bare"
                  ariaLabel="投放标的"
                />
                <div className="biz-stats">
                  <span className="biz-stat">
                    今日{mode}消耗(元) <b>{fmtMoney(todayCost(sliceAccounts))}</b>
                  </span>
                  <span className="biz-stat">
                    今日{mode}有消耗账户数 <b>{activeTodayCount(sliceAccounts)}</b>
                  </span>
                  <span className="biz-stat">
                    竞价余额不足账户数 <b className="warn">{lowBalanceCount(sliceAccounts)}</b>
                  </span>
                </div>
              </>
            ) : (
              <div className="biz-stats">
                <span className="biz-stat">
                  今日品牌消耗(元) <b>{fmtMoney(todayCost(sliceAccounts))}</b>
                </span>
                <span className="biz-stat">
                  今日品牌有消耗账户数 <b>{activeTodayCount(sliceAccounts)}</b>
                </span>
                <span className="biz-stat">
                  品牌余额不足账户数 <b className="warn">{lowBalanceCount(sliceAccounts)}</b>
                </span>
              </div>
            )}
            <div className="biz-right">
              <div className="pos-rel">
                <button
                  type="button"
                  className={`date-range ${dateOpen ? "is-open" : ""}`}
                  onClick={() => setDateOpen((prev) => !prev)}
                >
                  <CalendarDays size={14} className="cal" />
                  <span className="dates">
                    {range.start} <span className="tilde">~</span> {range.end}
                  </span>
                </button>
                {dateOpen && (
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 60, width: 316 }}>
                    <DateRangePopover
                      range={range}
                      onClose={() => setDateOpen(false)}
                      onApply={(next) => {
                        setRange(next);
                        setDateOpen(false);
                        setUpdatedAt(nowTime());
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* overview */}
          <div className="overview">
            <div className="overview-head">
              {channel === "brand" ? (
                <>
                  <button
                    type="button"
                    className={`scope-tab ${brandScope === "整体（不含搜索）" ? "is-active" : ""}`}
                    onClick={() => setBrandScope("整体（不含搜索）")}
                  >
                    整体（不含搜索）
                  </button>
                  <button
                    type="button"
                    className={`scope-tab ${brandScope === "搜索" ? "is-active" : ""}`}
                    onClick={() => setBrandScope("搜索")}
                  >
                    搜索
                  </button>
                  <span className="overview-desc">品牌广告按曝光与点击维度统计，与竞价指标分开呈现</span>
                </>
              ) : (
                <>
                  <span className="overview-title">数据概览</span>
                  <span className="overview-desc">
                    全域推广可拓展信息流推荐、直播广场等全域流量
                    <button
                      type="button"
                      className="btn-link"
                      style={{ marginLeft: 4 }}
                      onClick={() => toast("全域推广会把内容推荐流量纳入投放，帮助账户获取更泛的增量人群。", "info")}
                    >
                      了解更多
                    </button>
                  </span>
                </>
              )}
              <div className="overview-actions">
                <div className="pos-rel">
                  <button
                    type="button"
                    className="icon-btn bare"
                    aria-label="指标配置"
                    onClick={() => setKpiMenu((prev) => !prev)}
                  >
                    <SlidersHorizontal size={16} />
                  </button>
                  {kpiMenu && (
                    <>
                      <div className="click-catcher" onClick={() => setKpiMenu(false)} />
                      <div className="popover kpi-config" style={{ right: 0, top: "calc(100% + 6px)" }}>
                        <div className="title">显示指标</div>
                        {kpis.map((item) => (
                          <label key={item.key}>
                            <input
                              type="checkbox"
                              checked={!hiddenKpi.includes(item.key)}
                              onChange={() =>
                                setHiddenKpi((prev) =>
                                  prev.includes(item.key)
                                    ? prev.filter((key) => key !== item.key)
                                    : [...prev, item.key],
                                )
                              }
                            />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button type="button" className="icon-btn bare" aria-label="全屏查看" onClick={() => setModal("kpi")}>
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>

            <div className="kpi-grid">
              {visibleKpis.map((item) => {
                const delta = computeDeltaValue(item.value, item.prev);
                return (
                  <article className="kpi-card" key={item.key} title={item.hint}>
                    <div className="kpi-label">
                      {item.label}
                      <span className="info">
                        <LineChart size={11} />
                      </span>
                    </div>
                    <span className="kpi-spark">
                      <Sparkline values={item.spark.length > 1 ? item.spark : [0, 0]} />
                    </span>
                    <div className="kpi-value">
                      <b>{item.format(item.value)}</b>
                      {item.unit && <span className="unit">{item.unit}</span>}
                    </div>
                    <div className="kpi-compare">
                      <span className={`kpi-delta ${delta.direction}`}>{delta.text}</span>
                      <span>较上周期</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          {/* dimension tabs */}
          <div className="dim-tabs">
            {tabDefs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`dim-tab ${dim === tab.id ? "is-active" : ""}`}
                onClick={() => switchDim(tab.id)}
              >
                {tab.label}
                <span className="count">{tab.count}</span>
              </button>
            ))}
            <div className="tabs-right">
              {orgScope && (
                <button type="button" className="text-action" onClick={() => setOrgScope(null)}>
                  返回集团
                </button>
              )}
            </div>
          </div>

          {/* toolbar */}
          <div className="table-toolbar">
            {dim === "campaign" ? (
              <Select
                value={searchField}
                options={[
                  { value: "抖音号", label: "抖音号" },
                  { value: "商品", label: "商品" },
                  { value: "计划", label: "计划" },
                ]}
                onChange={(value) => setSearchField(value as "抖音号" | "商品" | "计划")}
                width={118}
                ariaLabel="搜索维度"
              />
            ) : dim === "account" ? (
              <Select value={quick} options={quickOptions} onChange={setQuick} width={118} ariaLabel="快速筛选" />
            ) : null}

            <div className="search-field">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
              />
              {search ? (
                <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="清空搜索">
                  <X size={13} />
                </button>
              ) : (
                <span className="suffix">
                  <Search size={14} />
                </span>
              )}
            </div>

            {dim === "account" && (
              <button
                type="button"
                className={`filter-btn ${activeFilterCount ? "has-value" : ""}`}
                onClick={() => {
                  setFiltersDraft(filters);
                  setModal("filters");
                }}
              >
                <Filter size={13} /> 更多筛选
                {activeFilterCount > 0 && <span className="badge badge-blue">{activeFilterCount}</span>}
              </button>
            )}

            <div className="toolbar-right">
              {dim === "org" && (
                <span className="text-hint">支持按组织逐层下钻</span>
              )}
              {dim !== "org" && (
                <div className="toolbar-actions">
                  <button type="button" className="icon-btn" aria-label="导出数据" onClick={exportCsv} data-tip="导出当前筛选结果">
                    <Download size={15} />
                  </button>
                  <div className="pos-rel">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="列设置"
                      onClick={() => setColumnsMenu((prev) => !prev)}
                      data-tip="列设置"
                    >
                      <Columns3 size={15} />
                    </button>
                    {columnsMenu && (
                      <>
                        <div className="click-catcher" onClick={() => setColumnsMenu(false)} />
                        <div className="popover col-settings-menu" style={{ right: 0, top: "calc(100% + 6px)" }}>
                          <div className="group-title">表格密度</div>
                          <div className="density-row">
                            <button
                              type="button"
                              className={density === "default" ? "is-active" : ""}
                              onClick={() => changeDensity("default")}
                            >
                              默认
                            </button>
                            <button
                              type="button"
                              className={density === "compact" ? "is-active" : ""}
                              onClick={() => changeDensity("compact")}
                            >
                              紧凑
                            </button>
                          </div>
                          <div className="menu-divider" />
                          <div className="menu-title">列宽与固定</div>
                          <div className="toggle-row">
                            <span>账户 / 计划信息固定</span>
                            <span className="tag tag-blue">已固定</span>
                          </div>
                          <div className="toggle-row">
                            <span>指标列自适应宽度</span>
                            <span className="tag tag-outline">自动</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="自定义列"
                    data-tip="自定义列"
                    onClick={() => setModal("columns")}
                  >
                    <Layers size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {(activeFilterCount > 0 || quick !== "all" || search) && (
            <div className="filter-chips">
              {search && (
                <span className="filter-chip">
                  搜索：{search}
                  <button type="button" onClick={() => setSearch("")} aria-label="清除搜索">
                    <X size={11} />
                  </button>
                </span>
              )}
              {quick !== "all" && (
                <span className="filter-chip">
                  {quickOptions.find((option) => option.value === quick)?.label}
                  <button type="button" onClick={() => setQuick("all")} aria-label="清除快速筛选">
                    <X size={11} />
                  </button>
                </span>
              )}
              {filters.costOp && filters.costValue && (
                <span className="filter-chip">
                  消耗 {filters.costOp === "gte" ? "≥" : "≤"} {filters.costValue} 元
                  <button type="button" onClick={() => setFilters({ ...filters, costOp: "", costValue: "" })} aria-label="清除消耗筛选">
                    <X size={11} />
                  </button>
                </span>
              )}
              {filters.balanceOp && filters.balanceValue && (
                <span className="filter-chip">
                  余额 {filters.balanceOp === "gte" ? "≥" : "≤"} {filters.balanceValue} 元
                  <button type="button" onClick={() => setFilters({ ...filters, balanceOp: "", balanceValue: "" })} aria-label="清除余额筛选">
                    <X size={11} />
                  </button>
                </span>
              )}
              <button type="button" className="filter-clear" onClick={clearFilters}>
                清空筛选
              </button>
            </div>
          )}

          {selected.size > 0 && dim !== "org" && (
            <div className="batch-bar">
              <span>
                已选 <b>{selected.size}</b> 个{dim === "account" ? "账户" : "推广"}
                <span className="muted">（当前页 {selectedOnPage} 个）</span>
              </span>
              <span className="vsep" />
              <button type="button" className="batch-action" onClick={() => batchSetStatus("投放中")}>
                <Zap size={13} /> 开启
              </button>
              <button type="button" className="batch-action" onClick={() => batchSetStatus("已暂停")}>
                <span style={{ fontSize: 13 }}>⏸</span> 暂停
              </button>
              <span className="vsep" />
              <button type="button" className="batch-action" onClick={exportCsv}>
                <Download size={13} /> 导出所选
              </button>
              <button type="button" className="batch-close" onClick={() => setSelected(new Set())} aria-label="关闭批量操作">
                <X size={15} />
              </button>
            </div>
          )}

          <div className="table-region">
            {dim === "org" ? (
              <OrgOverview
                rootId={orgScope ?? ROOT_ORG_ID}
                channel={channel}
                range={range}
                accounts={sliceAccounts}
                search={search}
                onDrill={(orgId) => {
                  setOrgScope(orgId);
                  setDim("account");
                  toast(`已下钻至 ${orgById(orgId)?.name ?? "组织"}`, "info");
                }}
              />
            ) : loading ? (
              <div className="table-loading">
                {Array.from({ length: 7 }).map((_, index) => (
                  <div className="skeleton-row" key={index}>
                    <span className="skeleton" style={{ width: 16, height: 16 }} />
                    <span className="skeleton" style={{ width: 180, height: 14 }} />
                    <span className="skeleton" style={{ width: 80, height: 12 }} />
                    <span className="skeleton" style={{ width: 90, height: 14, marginLeft: "auto" }} />
                    <span className="skeleton" style={{ width: 70, height: 14 }} />
                    <span className="skeleton" style={{ width: 70, height: 14 }} />
                  </div>
                ))}
              </div>
            ) : totalRows === 0 ? (
              <div className="empty">
                <div className="empty-art">
                  <Search size={26} />
                </div>
                <div className="empty-title">没有符合条件的{dim === "account" ? "账户" : "推广"}</div>
                <div className="empty-desc">尝试调整搜索、筛选条件或统计周期</div>
                <button type="button" className="btn btn-default btn-sm" onClick={clearFilters} style={{ marginTop: 8 }}>
                  清空筛选
                </button>
              </div>
            ) : dim === "account" ? (
              <AccountTable
                rows={pagedAccountRows}
                footerRows={sortedAccountRows}
                columns={visibleColumns}
                channel={channel}
                selected={selected}
                onSelect={handleSelect}
                onSelectAll={handleSelectAll}
                sort={sort}
                onSort={handleSort}
                density={density}
                onOpenAccount={(account) => setDrawer({ kind: "account", account })}
                onToggleFollow={toggleFollow}
                agentAccountIds={agentAccountIds}
                productCounts={productCounts}
              />
            ) : (
              <CampaignTable
                rows={pagedCampaignRows}
                footerRows={sortedCampaignRows}
                columns={visibleColumns}
                selected={selected}
                onSelect={handleSelect}
                onSelectAll={handleSelectAll}
                sort={sort}
                onSort={handleSort}
                density={density}
                onOpenAccount={(account) => setDrawer({ kind: "account", account })}
                onToggleCampaign={toggleCampaign}
                onOpenCampaign={(campaign) => {
                  const account = accountByIdMap.get(campaign.accountId);
                  if (account) setDrawer({ kind: "campaign", campaign, account });
                }}
                agentPlanIds={agentPlanIds}
                resolveProduct={resolveProduct}
              />
            )}
          </div>

          {dim !== "org" && !loading && totalRows > 0 && (
            <Pagination
              total={totalRows}
              page={safePage}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(size) => {
                if (PAGE_SIZES.includes(size)) {
                  setPageSize(size);
                  setPage(1);
                }
              }}
            />
          )}
        </section>
      </main>

      <ColumnsModal
        open={modal === "columns"}
        channel={channel}
        dimension={dim}
        value={visibleColumnIds}
        onClose={() => setModal(null)}
        onSave={handleSaveColumns}
      />

      <FiltersModal
        open={modal === "filters"}
        channel={channel}
        value={filtersDraft}
        onClose={() => setModal(null)}
        onApply={(next) => {
          setFilters(next);
          setModal(null);
          setPage(1);
          toast("筛选条件已应用", "success");
        }}
      />

      <KpiModal
        open={modal === "kpi"}
        onClose={() => setModal(null)}
        title={`${channel === "auction" ? "竞价投放" : "品牌投放"} · 数据概览`}
        kpis={visibleKpis}
        labels={kpiLabels}
        channel={channel}
        totalsSeries={kpiDaily}
      />

      <Modal
        open={healthOpen}
        onClose={() => setHealthOpen(false)}
        title="数据健康"
        desc="巨量千川报表 / 账户授权 / 商品交易数据"
        className="health-modal"
        footer={<button type="button" className="btn btn-default" onClick={() => setHealthOpen(false)}>关闭</button>}
      >
        <div className="health-summary">
          <div><span>最近同步</span><b>{dataHealth.lastSyncedAt}</b></div>
          <div><span>最大延迟</span><b>{dataHealth.lagMinutes} 分钟</b></div>
          <div><span>完整度</span><b>{Math.round(dataHealth.completeness * 100)}%</b></div>
          <div><span>账户</span><b>{dataHealth.totalAccounts} 个 · 延迟 {dataHealth.staleAccounts} · 部分授权 {dataHealth.partialAccounts}</b></div>
        </div>
        <div className="health-missing">
          <b>当前缺失字段</b>
          <span>{dataHealth.missing.length ? dataHealth.missing.join("、") : "无"}</span>
        </div>
        <div className="health-list">
          {accountHealthRows.map(({ account, health }) => (
            <div className="health-row" key={account.id}>
              <div className="health-main">
                <b>{account.name}</b>
                <span>{account.id} · 更新 {account.lastSyncedAt}</span>
              </div>
              <span className={`health-auth ${health.authorization === "已授权" ? "ok" : "warn"}`}>{health.authorization}</span>
              <span className="health-lag">{health.lagMinutes} 分钟</span>
              <span className="health-row-missing">{health.missing.length ? health.missing.join("、") : "字段齐全"}</span>
            </div>
          ))}
        </div>
        <p className="drawer-hint">
          千川报表约 5 分钟刷新；净成交、退款、结算依赖商品/交易授权；有效余额和共享钱包依赖资金权限。
          商品成本、毛利、物流、退货等经营数据不在千川报表内，因此不能据此判断绝对盈亏。
        </p>
      </Modal>

      <DetailDrawer
        target={drawer}
        campaigns={decoratedCampaigns}
        products={products}
        resolveProduct={resolveProduct}
        range={range}
        onRangeChange={(next) => {
          setRange(next);
          setUpdatedAt(nowTime());
        }}
        onClose={() => setDrawer(null)}
        onToggleCampaign={toggleCampaign}
        onOpenAccount={(account) => setDrawer({ kind: "account", account })}
        onAskGetMore={(scope) => {
          setDrawer(null);
          const subject = scope.planId
            ? `计划「${scope.planName ?? scope.planId}」（plan_id=${scope.planId}）`
            : `账户「${scope.accountName}」`;
          const goal = `请分析${subject}（account_id=${scope.accountId}）在 ${range.start} ~ ${range.end} 的投放表现，并给出下一步规划。先查数据，结合可用技能判断要调整预算、暂停还是只观察；给出依据、风险和预期；写动作只提交待确认 Decision，不要直接执行。`;
          if (scope.productId) {
            setPendingProductId(scope.productId);
            setPendingDraft(goal);
            setActiveTab("workspace");
            return;
          }
          startPartnerTask(goal);
        }}
        onSaveProduct={saveProduct}
        onDeleteProduct={deleteProduct}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small local helpers                                                */
/* ------------------------------------------------------------------ */

function computeDeltaValue(current: number | null, previous: number | null): {
  direction: "up" | "down" | "flat";
  text: string;
} {
  if (current === null || previous === null || previous === 0) {
    return { direction: "flat", text: "--" };
  }
  const ratio = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(ratio) < 0.05) return { direction: "flat", text: "0.0%" };
  return {
    direction: ratio > 0 ? "up" : "down",
    text: `${ratio > 0 ? "↑" : "↓"} ${Math.abs(ratio).toFixed(1)}%`,
  };
}
