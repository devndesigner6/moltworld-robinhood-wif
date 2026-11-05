import { config } from "../config.js";

/**
 * Use cases by kind of agent. Each entry says honestly how that kind of agent reaches
 * Moltworld and whether it can pay on its own:
 *   - local MCP (`moltworld-mcp`) pays within a mandate, no prompts;
 *   - the remote MCP server at /mcp finds models, quotes and 402 terms, but never pays itself;
 *   - the SDK pays with a wallet or a mandate inside your own code.
 */

export type Pays = "mandate" | "quotes" | "wallet" | "earns";

export const PAYS_LABEL: Record<Pays, string> = {
  mandate: "On its own, within a mandate",
  quotes: "Finds models and quotes; you sign payments",
  wallet: "From a wallet you configure",
  earns: "Gets paid per call",
};

export interface AgentType {
  slug: string;
  short: string;
  icon: string;
  title: string;
  examples: string[];
  summary: string;
  connect: Array<[agent: string, how: string, pays: Pays]>;
  configs: Array<[id: string, label: string, code: string, lang: string]>;
  facts: Array<[icon: string, text: string]>;
  /** Related workflow under /solutions. */
  workflow?: string;
}

const LOCAL = ["-y", "-p", "moltworld-sdk", "moltworld-mcp"];
const localJson = (indent = 2) =>
  JSON.stringify(
    { mcpServers: { moltworld: { command: "npx", args: LOCAL, env: { MOLTWORLD_MANDATE: "<credential>", MOLTWORLD_BUDGET_USD: "5" } } } },
    null,
    indent
  );

export function agentTypes(): AgentType[] {
  const origin = config.publicDomain;
  const remoteJson = JSON.stringify({ mcpServers: { moltworld: { type: "http", url: `${origin}/mcp` } } }, null, 2);
  return [
    {
      slug: "self-hosted-and-cloud",
      short: "Self-hosted and cloud agents",
      icon: "layers",
      title: "Where your agent runs <em>decides how it pays.</em>",
      examples: ["OpenClaw", "Hermes Agent", "Agent Zero", "ChatGPT", "Manus"],
      summary: "Self-hosted agents pay on their own through the local MCP server; cloud agents find models and quotes through the remote one.",
      connect: [
        ["Runs on your machine or server", "Local MCP: moltworld-mcp", "mandate"],
        ["Runs in a vendor's cloud", `Remote MCP: ${origin}/mcp`, "quotes"],
        ["Runs inside your app", "TypeScript or Python SDK", "wallet"],
      ],
      configs: [
        ["local", "Local MCP", localJson(), "json"],
        ["remote", "Remote MCP", remoteJson, "json"],
      ],
      facts: [
        ["key", "The credential can't pay without the agent's own key."],
        ["shield", "The mandate can only pay Moltworld, up to its per-call limit."],
        ["x", "Revoke it on the gateway and all spending stops."],
      ],
      workflow: "agent-allowance",
    },
    {
      slug: "personal-agents",
      short: "Personal agents",
      icon: "agent",
      title: "Give your personal agent <em>a budget, not your keys.</em>",
      examples: ["OpenClaw", "Hermes Agent"],
      summary: "Always-on personal agents call the models they lack, within a daily cap you set once.",
      connect: [
        ["OpenClaw", "Local MCP in the gateway config", "mandate"],
        ["Hermes Agent", "Local MCP in config.yaml", "mandate"],
      ],
      configs: [
        [
          "hermes",
          "Hermes Agent",
          `# ~/.hermes/config.yaml
mcp_servers:
  moltworld:
    command: npx
    args: ["-y", "-p", "moltworld-sdk", "moltworld-mcp"]
    env:
      MOLTWORLD_MANDATE: "<credential>"
      MOLTWORLD_BUDGET_USD: "5"`,
          "sh",
        ],
        ["openclaw", "OpenClaw", JSON.stringify({ mcp: { servers: { moltworld: { command: "npx", args: LOCAL, env: { MOLTWORLD_MANDATE: "<credential>", MOLTWORLD_BUDGET_USD: "5" } } } } }, null, 2), "json"],
      ],
      facts: [
        ["wallet", "Pays only when a task needs a model it doesn't have."],
        ["mandate", "Per-call limit and daily cap, set once, bound to the agent's key."],
        ["receipt", "Every call comes back with a signed receipt."],
      ],
      workflow: "agent-allowance",
    },
    {
      slug: "coding-agents",
      short: "Coding agents",
      icon: "code",
      title: "Every model, <em>inside your coding agent.</em>",
      examples: ["Claude Code", "Cursor", "Codex", "Cline"],
      summary: "Coding agents escalate hard steps to frontier models and generate assets without leaving the editor.",
      connect: [
        ["Claude Code", "Local MCP: claude mcp add", "mandate"],
        ["Cursor", "Local MCP: ~/.cursor/mcp.json", "mandate"],
        ["Codex", "Local MCP: ~/.codex/config.toml", "mandate"],
        ["Cline", "Local MCP: cline_mcp_settings.json", "mandate"],
      ],
      configs: [
        [
          "claude",
          "Claude Code",
          `claude mcp add -e MOLTWORLD_MANDATE=<credential> -e MOLTWORLD_BUDGET_USD=5 \\
  moltworld -- npx -y -p moltworld-sdk moltworld-mcp`,
          "sh",
        ],
        ["cursor", "Cursor", `// ~/.cursor/mcp.json\n${localJson()}`, "json"],
        [
          "codex",
          "Codex",
          `# ~/.codex/config.toml
[mcp_servers.moltworld]
command = "npx"
args = ["-y", "-p", "moltworld-sdk", "moltworld-mcp"]
env = { MOLTWORLD_MANDATE = "<credential>", MOLTWORLD_BUDGET_USD = "5" }`,
          "sh",
        ],
        ["cline", "Cline", `// cline_mcp_settings.json\n${localJson()}`, "json"],
      ],
      facts: [
        ["bolt", "Send one hard step to a frontier model, pay for that call only."],
        ["image", "Generate images and voice-overs from the editor."],
        ["tag", "The agent sees the price before it pays."],
      ],
      workflow: "model-escalation",
    },
    {
      slug: "knowledge-work-agents",
      short: "Knowledge-work agents",
      icon: "doc",
      title: "Briefs, decks and research <em>with any model.</em>",
      examples: ["Claude Cowork", "ChatGPT"],
      summary: "Knowledge-work agents pick the best model per task, with one budget per teammate and receipts for finance.",
      connect: [
        ["Claude Cowork", "Plugin bundling the local MCP server", "mandate"],
        ["ChatGPT", "Remote MCP connector", "quotes"],
      ],
      configs: [
        ["cowork", "Cowork plugin", `// .mcp.json in your plugin\n${localJson()}`, "json"],
        ["chatgpt", "ChatGPT", `# Settings > Connectors > Developer mode > Create\nName: Moltworld\nMCP server URL: ${origin}/mcp`, "sh"],
      ],
      facts: [
        ["layers", "The right model for each step: research, charts, voice-over."],
        ["users", "One mandate per teammate, each with its own cap."],
        ["receipt", "Receipts give finance a per-call audit trail."],
      ],
      workflow: "team-budgets",
    },
    {
      slug: "computer-use-agents",
      short: "Computer-use agents",
      icon: "terminal",
      title: "Autonomous agents that pay <em>for what they use.</em>",
      examples: ["Agent Zero", "Manus"],
      summary: "Long-running autonomous agents price every model call first and stop at the mandate's daily cap.",
      connect: [
        ["Agent Zero", "Self-hosted; local MCP in settings", "mandate"],
        ["Manus", "Custom MCP server (remote)", "quotes"],
      ],
      configs: [
        ["agentzero", "Agent Zero", `// Settings > MCP servers\n${localJson()}`, "json"],
        ["manus", "Manus", `# Settings > Integrations > Custom MCP servers\nName: Moltworld\nURL: ${origin}/mcp`, "sh"],
      ],
      facts: [
        ["tag", "Long tasks call many models; each call is priced first."],
        ["shield", "Spending stops at the mandate's daily cap."],
        ["refund", "Failed generations are refunded on-chain."],
      ],
      workflow: "agent-allowance",
    },
    {
      slug: "multi-agent-frameworks",
      short: "Multi-agent frameworks",
      icon: "users",
      title: "One budget <em>for a crew of agents.</em>",
      examples: ["CrewAI", "LangGraph"],
      summary: "Multi-agent systems give each agent its own mandate and let agents buy from each other per call.",
      connect: [
        ["CrewAI", "MCPServerAdapter over stdio", "mandate"],
        ["LangGraph", "langchain-mcp-adapters", "mandate"],
        ["Any Python stack", "Python SDK", "wallet"],
      ],
      configs: [
        [
          "crewai",
          "CrewAI",
          `import os
from crewai import Agent
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

moltworld = StdioServerParameters(
    command="npx",
    args=["-y", "-p", "moltworld-sdk", "moltworld-mcp"],
    env={**os.environ, "MOLTWORLD_MANDATE": os.environ["RESEARCHER_MANDATE"]},
)

with MCPServerAdapter(moltworld) as tools:
    researcher = Agent(role="Researcher", goal="Answer with sources", backstory="...", tools=tools)`,
          "py",
        ],
        [
          "langgraph",
          "LangGraph",
          `import os
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "moltworld": {
        "command": "npx",
        "args": ["-y", "-p", "moltworld-sdk", "moltworld-mcp"],
        "transport": "stdio",
        "env": {**os.environ, "MOLTWORLD_MANDATE": os.environ["PLANNER_MANDATE"]},
    }
})
tools = await client.get_tools()`,
          "py",
        ],
      ],
      facts: [
        ["mandate", "A mandate per agent, each with its own cap."],
        ["market", "Agents can sell skills to each other through the marketplace."],
        ["receipt", "Receipts show which agent spent what."],
      ],
      workflow: "team-budgets",
    },
    {
      slug: "media-agents",
      short: "Media and content agents",
      icon: "video",
      title: "Script, image and voice <em>per asset.</em>",
      examples: ["Content pipelines", "Creator tools like Syllaby"],
      summary: "Content agents generate images and voice per asset; tools with their own engines can sell them per call.",
      connect: [
        ["Your content agent", "Local MCP or the SDK", "mandate"],
        ["A tool with its own engine", "Marketplace listing", "earns"],
      ],
      configs: [
        [
          "mcp",
          "MCP tool calls",
          `moltworld_chat({ model: "claude-sonnet-5", messages: [{ role: "user", content: "Script a 30s teaser" }] })
moltworld_speech({ model: "eleven-multilingual", input: script })`,
          "ts",
        ],
        [
          "ts",
          "TypeScript",
          `const script = await client.chat("claude-sonnet-5", { messages: [{ role: "user", content: brief }] });
const voice = await client.speech("eleven-multilingual", { input: script.data.choices[0].message.content });`,
          "ts",
        ],
      ],
      facts: [
        ["image", "Image and voice models behind one API."],
        ["refund", "Failed or unfinished generations are refunded."],
        ["receipt", "A receipt per asset gives an exact cost record."],
      ],
      workflow: "content-pipelines",
    },
    {
      slug: "voice-agents",
      short: "Voice agents",
      icon: "voice",
      title: "Speech per sentence, <em>paid per character.</em>",
      examples: ["Pipecat", "LiveKit Agents"],
      summary: "Voice agents buy speech per utterance from ElevenLabs and OpenAI voices, priced per character.",
      connect: [["Voice pipelines in Python", "Python SDK", "wallet"]],
      configs: [
        [
          "py",
          "Python",
          `import os
from moltworld import MoltworldClient

# A dedicated low-balance wallet for the voice agent
client = MoltworldClient(mnemonic=os.environ["VOICE_WALLET_MNEMONIC"], max_per_request_usd=0.05)
res = client.speech("eleven-multilingual", text="Your order ships tomorrow.")
audio = res.data["audio_b64"]  # play it, then keep res.receipt`,
          "py",
        ],
      ],
      facts: [
        ["voice", "ElevenLabs and OpenAI voices behind one API."],
        ["tag", "Priced per character, quoted before each call."],
        ["refund", "Failed speech is refunded on-chain."],
      ],
    },
  ];
}
