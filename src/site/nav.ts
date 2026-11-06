import { config } from "../config.js";
import { agentTypes } from "./agents.js";

export interface NavLink {
  label: string;
  href: string;
  icon: string;
}

export interface NavGroup {
  /** Announced to assistive tech; not shown. */
  title: string;
  links: NavLink[];
  /** Secondary column: rendered as plain text links. */
  minor?: boolean;
}

export interface NavMenu {
  id: string;
  label: string;
  /** Overview page for the section. */
  href: string;
  groups: NavGroup[];
  /** Extra paths that mark this section as current. */
  match?: string[];
}

/** Jobs people do with Moltworld, whatever agent they use. Pages live under /solutions. */
export const WORKFLOWS = [
  {
    slug: "agent-allowance",
    short: "Agent allowances",
    title: "Give your agent a budget, not your keys",
    summary: "A capped, revocable allowance for the models your always-on agent doesn't have.",
  },
  {
    slug: "model-escalation",
    short: "Model escalation",
    title: "Pay for a frontier model only on the hard steps",
    summary: "Run on a cheap model and pay for a frontier model only when a step needs it.",
  },
  {
    slug: "content-pipelines",
    short: "Content pipelines",
    title: "Script, image and voice through one API",
    summary: "Generate every asset per post through one API, with failed jobs refunded on-chain.",
  },
  {
    slug: "agent-commerce",
    short: "Agent commerce",
    title: "Let agents buy from agents",
    summary: "Sell your API or agent skill to other agents and get paid per call in USDC.",
  },
  {
    slug: "team-budgets",
    short: "Team budgets",
    title: "One budget per agent, one audit trail",
    summary: "A mandate per agent or teammate, each with its own limits and its own receipts.",
  },
] as const;

/** What a customer can adopt on its own. */
export const PRODUCTS = [
  { label: "Gateway", href: "/products/gateway", icon: "gateway" },
  { label: "Mandates", href: "/products/mandates", icon: "mandate" },
  { label: "Marketplace", href: "/products/marketplace", icon: "market" },
] as const;

/** What every paid call gets, whichever product made it. */
export function builtIn() {
  return [
    { label: "Signed receipts", href: "/products/receipts", icon: "receipt" },
    { label: "Refunds and rebates", href: `${config.docsUrl}/concepts/refunds-and-rebates`, icon: "refund" },
  ];
}

export const AUDIENCES = [
  { label: "AI agents", href: "/solutions/agents", icon: "agent" },
  { label: "App developers", href: "/solutions/developers", icon: "code" },
  { label: "API sellers", href: "/solutions/api-creators", icon: "plug" },
] as const;

export function navMenus(): NavMenu[] {
  const docs = config.docsUrl;
  const activeProducts = config.paymentChain === "robinhood" ? PRODUCTS.filter((p) => p.label === "Gateway") : PRODUCTS;
  const activeBuiltIns = config.paymentChain === "robinhood" ? builtIn().filter((p) => p.label === "Signed receipts") : builtIn();
  const activeAudiences = config.paymentChain === "robinhood" ? AUDIENCES.filter((a) => a.label !== "API sellers") : AUDIENCES;
  const activeWorkflows = config.paymentChain === "robinhood" ? WORKFLOWS.filter((u) => u.slug === "model-escalation") : WORKFLOWS;
  return [
    {
      id: "products",
      label: "Product",
      href: "/products",
      groups: [
        { title: "Products", links: activeProducts.map((p) => ({ ...p })) },
        { title: "Built into every call", links: activeBuiltIns, minor: true },
      ],
    },
    {
      id: "solutions",
      label: "Solutions",
      href: "/solutions",
      groups: [
        { title: "By customer", links: activeAudiences.map((a) => ({ ...a })) },
        { title: "By workflow", links: activeWorkflows.map((u) => ({ label: u.short, href: `/solutions/${u.slug}`, icon: "spark" })), minor: true },
      ],
    },
    (() => {
      const types = agentTypes().map((t) => ({ label: t.short, href: `/use-cases/${t.slug}`, icon: t.icon }));
      const half = Math.ceil(types.length / 2);
      return {
        id: "use-cases",
        label: "Use cases",
        href: "/use-cases",
        groups: [
          { title: "By kind of agent", links: types.slice(0, half) },
          { title: "More kinds of agent", links: types.slice(half) },
        ],
      };
    })(),
    {
      id: "developers",
      label: "Developers",
      href: "/developers",
      match: ["/playground", "/stats"],
      groups: [
        {
          title: "Documentation",
          links: config.paymentChain === "robinhood"
            ? [
                { label: "WIF Quickstart", href: "/quickstart", icon: "bolt" },
                { label: "Full documentation", href: docs, icon: "book" },
                { label: "API reference", href: `${docs}/api-reference/introduction`, icon: "braces" },
                { label: "MCP and agents", href: `${docs}/agents/mcp`, icon: "agent" },
                { label: "SDKs", href: `${docs}/sdks/typescript`, icon: "package" },
              ]
            : [
                { label: "Documentation", href: docs, icon: "book" },
                { label: "Quickstart", href: `${docs}/quickstart`, icon: "bolt" },
                { label: "API reference", href: `${docs}/api-reference/introduction`, icon: "braces" },
                { label: "SDKs", href: `${docs}/sdks/typescript`, icon: "package" },
                { label: "MCP and agents", href: `${docs}/agents/mcp`, icon: "agent" },
              ],
        },
        {
          title: "Tools",
          links: [
            { label: "Developer hub", href: "/developers", icon: "terminal" },
            { label: "Playground", href: "/playground", icon: "play" },
            { label: "Live network", href: "/stats", icon: "pulse" },
            { label: "llms.txt", href: "/llms.txt", icon: "doc" },
            { label: "GitHub", href: config.paymentChain === "robinhood" ? "https://github.com/devndesigner6/moltworld-x402-gateway" : "https://github.com/hackcat29/moltworld-x402", icon: "github" },
          ],
        },
      ],
    },
  ];
}

/** Plain links that sit next to the menus. */
export const NAV_LINKS = [
  { label: "Models", href: "/models" },
  { label: "Pricing", href: "/pricing" },
  { label: "Stats", href: "/stats" },
];
