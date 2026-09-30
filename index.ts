import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk": "^1.14.0";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import Parser from "rss-parser";

const parser = new Parser();

// Tes flux ici — modifie librement puis redéploie
const FEEDS: Record<string, string> = {
  "Hacker News": "https://hnrss.org/frontpage",
  "Le Monde": "https://www.lemonde.fr/rss/une.xml",
  "LWN": "https://lwn.net/headlines/rss",
};

const server = new McpServer({ name: "rss-aggregator", version: "1.0.0" });

server.tool(
  "list_feeds",
  "Lister les flux RSS configurés",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(FEEDS, null, 2) }],
  })
);

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

const app = express();
app.use(express.json());

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP RSS aggregator on ${PORT}`));
