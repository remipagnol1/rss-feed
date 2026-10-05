// ============================================================================
// IMPORTS
// ============================================================================
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import Parser from "rss-parser";

// ============================================================================
// CONFIGURATION
// ============================================================================
const parser = new Parser();

// Tes flux ici — modifie librement puis redéploie
const FEEDS: Record<string, string> = {
  "Leptidigital": "https://www.leptidigital.fr/feed/",
  "Blog du Modérateur": "https://www.blogdumoderateur.com/feed/",
  "Korben": "https://korben.info/feed",
  "Comfy": "https://blog.comfy.org/feed",
  "Kim Komando": "https://komando.substack.com/feed",
  "Supabase": "https://www.supabase.com/rss.xml",
  "HubSpot": "https://blog.hubspot.fr/marketing/rss.xml",
  "Reve Blog": "https://blog.reve.com/feed.xml",
  "GitHub Blog": "https://github.blog/fr/feed/",
  "Upmynt": "https://www.upmynt.com/rss/",
};

// ============================================================================
// MCP SERVER INITIALIZATION
// ============================================================================
const server = new McpServer({ name: "rss-aggregator", version: "1.0.0" });

// ============================================================================
// MCP TOOLS
// ============================================================================

// --- Tool 1: List available feeds ---
server.tool(
  "list_feeds",
  "Lister les flux RSS configurés",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(FEEDS, null, 2) }],
  })
);

// --- Tool 2: Get latest articles (limited by count) ---
server.tool(
  "get_news",
  "Agréger les derniers articles de tous les flux RSS",
  {
    perFeed: z.number().default(5).describe("Articles max par flux"),
  },
  async ({ perFeed }) => {
    const results = await Promise.allSettled(
      Object.entries(FEEDS).map(async ([name, url]) => {
        const feed = await parser.parseURL(url);
        return {
          feed: name,
          items: feed.items.slice(0, perFeed).map((i) => ({
            titre: i.title,
            lien: i.link,
            date: i.isoDate,
          })),
        };
      })
    );
    const ok = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);
    const errors = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason.message);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ articles: ok, erreurs: errors }, null, 2),
      }],
    };
  }
);

// --- Tool 3: Get articles from last N days ---
server.tool(
  "get_news_last_7_days",
  "Agréger les articles de tous les flux RSS des 7 derniers jours",
  {
    daysBack: z.number().default(7).describe("Nombre de jours à récupérer"),
  },
  async ({ daysBack }) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const results = await Promise.allSettled(
      Object.entries(FEEDS).map(async ([name, url]) => {
        const feed = await parser.parseURL(url);
        return {
          feed: name,
          items: feed.items
            .filter((i) => {
              if (!i.isoDate) return false;
              const itemDate = new Date(i.isoDate);
              return itemDate >= cutoffDate;
            })
            .map((i) => ({
              titre: i.title,
              lien: i.link,
              date: i.isoDate,
            })),
        };
      })
    );

    const ok = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);
    const errors = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason.message);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ articles: ok, erreurs: errors }, null, 2),
      }],
    };
  }
);

// ============================================================================
// EXPRESS SERVER SETUP
// ============================================================================
const app = express();
app.use(express.json());

// --- MCP Endpoint ---
app.post("/mcp", async (req, res) => {
  try {
    // Une instance de transport par session (stateless simplifié)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // mode stateless
    });
    res.on("close", () => { void transport.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP RSS aggregator on ${PORT}`));
