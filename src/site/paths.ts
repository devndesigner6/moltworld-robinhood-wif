import { agentTypes } from "./agents.js";
import { WORKFLOWS } from "./nav.js";

/** Every HTML page the site serves (used for rate limiting and tests). */
export const SITE_PATHS = [
  "/",
  "/products",
  "/products/gateway",
  "/models",
  "/products/mandates",
  "/products/marketplace",
  "/products/receipts",
  "/pricing",
  "/developers",
  "/solutions",
  "/solutions/agents",
  "/solutions/developers",
  "/solutions/api-creators",
  ...WORKFLOWS.map((u) => `/solutions/${u.slug}`),
  "/use-cases",
  ...agentTypes().map((t) => `/use-cases/${t.slug}`),
  // Workflows used to live here; they redirect to /solutions.
  ...WORKFLOWS.map((u) => `/use-cases/${u.slug}`),
  "/playground",
  "/stats",
];
