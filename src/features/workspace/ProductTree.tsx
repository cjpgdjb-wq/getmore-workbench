import { useMemo, useState } from "react";
import { Building2, ChevronDown, CircleDashed, Package, Sparkles } from "lucide-react";
import {
  ACCOUNTS,
  BRAND_CAMPAIGNS,
  CAMPAIGNS,
  PRODUCTS,
  ROOT_ORG_ID,
  orgById,
  type Product,
} from "../../data/mock";
import type { ProductThread } from "./productThreads";

interface ProductTreeProps {
  threads: ProductThread[];
  activeThreadId: string | null;
  onRequestThread: (productId: string) => void;
  onOpenThread: (threadId: string) => void;
}

interface ProductEntry {
  product: Product;
  accountId: string;
  accountName: string;
  accountChannel: "auction" | "brand";
  planCount: number;
}

interface OrgEntry {
  id: string;
  name: string;
  products: ProductEntry[];
  children: OrgEntry[];
}

export default function ProductTree({
  threads,
  activeThreadId,
  onRequestThread,
  onOpenThread,
}: ProductTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([ROOT_ORG_ID, ...(orgById(ROOT_ORG_ID)?.children ?? [])]),
  );

  const threadByProduct = useMemo(
    () => new Map(threads.map((thread) => [thread.productId, thread])),
    [threads],
  );

  const tree = useMemo(() => {
    const accountById = new Map(ACCOUNTS.map((account) => [account.id, account]));
    const countByProduct = new Map<string, number>();
    for (const campaign of [...CAMPAIGNS, ...BRAND_CAMPAIGNS]) {
      countByProduct.set(campaign.productId, (countByProduct.get(campaign.productId) ?? 0) + 1);
    }
    const build = (orgId: string): OrgEntry | null => {
      const org = orgById(orgId);
      if (!org) return null;
      const products = PRODUCTS.filter((product) => {
        const account = accountById.get(product.accountId);
        return account?.orgId === orgId && (countByProduct.get(product.id) ?? 0) > 0;
      })
        .map((product) => ({
          product,
          accountId: product.accountId,
          accountName: accountById.get(product.accountId)?.name ?? "",
          accountChannel: accountById.get(product.accountId)?.channel ?? "auction",
          planCount: countByProduct.get(product.id) ?? 0,
        }))
        .sort((a, b) => a.product.name.localeCompare(b.product.name, "zh-CN"));
      const children = org.children
        .map((childId) => build(childId))
        .filter((entry): entry is OrgEntry => Boolean(entry));
      if (products.length === 0 && children.length === 0) return null;
      return { id: org.id, name: org.name, products, children };
    };
    return build(ROOT_ORG_ID);
  }, []);

  if (!tree) return <div className="ws-product-empty">暂无可建立智能助手的商品</div>;

  const toggle = (orgId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const renderOrg = (entry: OrgEntry, depth: number) => {
    const isOpen = expanded.has(entry.id);
    const totalProducts = countProducts(entry);
    return (
      <div className="ws-org" key={entry.id}>
        <button
          type="button"
          className={`ws-org-row depth-${depth}`}
          onClick={() => toggle(entry.id)}
          aria-expanded={isOpen}
        >
          <ChevronDown size={11} className={`chev ${isOpen ? "is-open" : ""}`} />
          <Building2 size={12} />
          <span>{entry.name}</span>
          <span className="ws-org-count">{totalProducts}</span>
        </button>
        {isOpen && (
          <div className="ws-org-children">
            {entry.children.map((child) => renderOrg(child, depth + 1))}
            {groupByAccount(entry.products).map((group) => (
              <div className="ws-account-group" key={group.accountId}>
                <div className="ws-account-row">
                  <span className="ws-account-name" title={group.accountName}>{group.accountName}</span>
                  <span className={`ws-account-channel ${group.accountChannel}`}>
                    {group.accountChannel === "brand" ? "品牌" : "竞价"}
                  </span>
                  <span className="ws-account-count">{group.products.length}</span>
                </div>
                {group.products.map(({ product, planCount }) => {
                  const thread = threadByProduct.get(product.id);
                  return (
                    <button
                      type="button"
                      key={product.id}
                      className={`ws-product-row ${thread?.id === activeThreadId ? "is-active" : ""} ${thread ? "is-created" : ""}`}
                      onClick={() => {
                        if (thread) onOpenThread(thread.id);
                        else onRequestThread(product.id);
                      }}
                      title={thread ? `打开「${product.name}」智能助手` : `为「${product.name}」建立智能助手`}
                    >
                      <span className="ws-product-icon">
                        {thread ? <Sparkles size={11} /> : <CircleDashed size={11} />}
                      </span>
                      <span className="ws-product-main">
                        <span className="ws-product-name">
                          <Package size={10} />
                          {product.name}
                        </span>
                        <span className="ws-product-meta">{planCount} 个计划</span>
                      </span>
                      <span className={`ws-product-badge ${thread ? "created" : ""}`}>
                        {thread ? "已建立" : "未建立"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return <div className="ws-product-tree">{renderOrg(tree, 0)}</div>;
}

function countProducts(entry: OrgEntry): number {
  return entry.products.length + entry.children.reduce((sum, child) => sum + countProducts(child), 0);
}

function groupByAccount(products: ProductEntry[]) {
  const map = new Map<
    string,
    {
      accountId: string;
      accountName: string;
      accountChannel: "auction" | "brand";
      products: ProductEntry[];
    }
  >();
  for (const product of products) {
    const group = map.get(product.accountId) ?? {
      accountId: product.accountId,
      accountName: product.accountName,
      accountChannel: product.accountChannel,
      products: [],
    };
    group.products.push(product);
    map.set(product.accountId, group);
  }
  return [...map.values()].sort((a, b) => a.accountName.localeCompare(b.accountName, "zh-CN"));
}
