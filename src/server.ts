/**
 * Chat server — a browser UI bolted onto the tool-calling agent loop.
 *
 *   POST /api/chat   { sessionId, message } -> { reply }
 *   POST /api/reset  { sessionId }          -> { ok }
 *   GET  /           serves public/index.html
 *
 * Sessions live in memory: a Map<sessionId, messages>. Restarting the
 * server clears all conversations. This is fine for a classroom demo —
 * add Redis or a DB for anything real.
 */
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

// __dirname isn't defined in ES modules, so we derive it from the
// module URL. We need it later to serve the static UI from /public.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================
// 1. Tool definitions
// =============================================================
// Each tool() call wraps a plain async function so LangChain can:
//   - describe it to the model (name + description),
//   - validate the model's arguments against the Zod schema,
//   - and run it when the model decides to call it.

const fetchWeather = tool(
  async ({ city }) => {
    // Fake DB. In production this would hit a real weather API.
    const db: Record<string, { temperature_f: number; condition: string }> = {
      austin: { temperature_f: 88, condition: "sunny" },
      seattle: { temperature_f: 54, condition: "rainy" },
      "new york": { temperature_f: 62, condition: "cloudy" },
    };
    return (
      db[city.toLowerCase()] ?? { temperature_f: 70, condition: "unknown" }
    );
  },
  {
    name: "fetch_weather",
    description: "Get the current weather for a city.",
    schema: z.object({ city: z.string() }),
  }
);

const recommendActivity = tool(
  async ({ condition }) => {
    const book: Record<string, string> = {
      sunny: "Go for a run outside.",
      rainy: "Stay in and read a book.",
      cloudy: "Visit a museum.",
    };
    return book[condition.toLowerCase()] ?? "Do whatever you want.";
  },
  {
    name: "recommend_activity",
    description:
      "Recommend an activity given a weather condition ('sunny', 'rainy', 'cloudy').",
    schema: z.object({ condition: z.string() }),
  }
);

const solveQuadratic = tool(
  async ({ a, b, c }) => {
    if (a === 0) return { error: "Coefficient 'a' must be non-zero." };
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return { root1: (-b + s) / (2 * a), root2: (-b - s) / (2 * a) };
    }
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * a);
    return { root1: `${re} + ${im}i`, root2: `${re} - ${im}i` };
  },
  {
    name: "solve_quadratic",
    description:
      "Solve ax^2 + bx + c = 0. Handles real and complex roots.",
    schema: z.object({ a: z.number(), b: z.number(), c: z.number() }),
  }
);

const fibonacci = tool(
  async ({ n }) => {
    if (n <= 0) return [];
    const seq: bigint[] = [0n, 1n];
    while (seq.length < n) {
      seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
    }
    return seq.slice(0, n).map(String);
  },
  {
    name: "fibonacci",
    description:
      "Return the first n Fibonacci numbers (BigInt, handles large n).",
    schema: z.object({ n: z.number().int() }),
  }
);

const convertCurrency = tool(
  async ({ amount, from, to }) => {
    const res = await fetch(
      `https://open.er-api.com/v6/latest/${from.toUpperCase()}`
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[to.toUpperCase()];
    if (rate === undefined) return { error: `Unknown currency: ${to}` };
    return {
      amount,
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      converted: Math.round(amount * rate * 100) / 100,
      rate,
    };
  },
  {
    name: "convert_currency",
    description:
      "Convert between two ISO 4217 currency codes using live exchange rates.",
    schema: z.object({
      amount: z.number(),
      from: z.string().describe("ISO 4217 code, e.g. 'USD'"),
      to: z.string().describe("ISO 4217 code, e.g. 'EUR'"),
    }),
  }
);

// Register every tool here, plus a name -> tool lookup we use during
// the agent loop to dispatch the model's tool_calls back to the
// real function.
const tools = [
  fetchWeather,
  recommendActivity,
  solveQuadratic,
  fibonacci,
  convertCurrency,
];
// Typed as `any` so we can call `.invoke()` uniformly — different tools
// have different argument types, which TS can't unify across the lookup.
const toolsByName: Record<string, any> = Object.fromEntries(
  tools.map((t) => [t.name, t])
);

// =============================================================
// 2. Model setup
// =============================================================
// temperature: 0 keeps responses deterministic — important when we
// want the model to reliably pick the right tool every time.
const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

// bindTools returns a wrapped LLM that knows about our tools.
// When we invoke it, the model can decide to call any of them.
const llmWithTools = llm.bindTools(tools);

// The system prompt is the first message in every conversation.
// It frames the model's role and nudges it toward using tools.
const systemPrompt = new SystemMessage(
  "You are a helpful assistant with access to tools for weather, activity " +
    "suggestions, quadratic equations, Fibonacci numbers, and currency " +
    "conversion. Use a tool whenever it gives a more accurate answer than " +
    "your own knowledge."
);

// =============================================================
// 3. Conversation memory
// =============================================================
// One Map entry per browser session. Each value is the full message
// history so the model can answer follow-ups in context (e.g. "and
// what about Seattle?" knows we were just talking about weather).
// Cleared on server restart.
const sessions = new Map<string, BaseMessage[]>();

// Safety cap so a misbehaving model can't loop forever calling tools.
const MAX_STEPS = 8;

// =============================================================
// 4. The agent loop
// =============================================================
// Same shape as lessons 1 and 2:
//   invoke model -> got tool_calls? run them, append results, invoke again.
//   no tool_calls -> we have the final answer; return it.
async function chat(sessionId: string, userMessage: string): Promise<string> {
  console.log(`user: ${userMessage}`);

  // Start fresh with the system prompt, or pick up where we left off.
  const messages = sessions.get(sessionId) ?? [systemPrompt];
  messages.push(new HumanMessage(userMessage));

  for (let i = 0; i < MAX_STEPS; i++) {
    // Round-trip: ask the model what to do next.
    const aiMsg = await llmWithTools.invoke(messages);
    messages.push(aiMsg);

    // No tool calls = the model is done. Return its text answer.
    if (!aiMsg.tool_calls?.length) {
      const reply =
        typeof aiMsg.content === "string"
          ? aiMsg.content
          : JSON.stringify(aiMsg.content);
      console.log(`assistant: ${reply}`);
      sessions.set(sessionId, messages);
      return reply;
    }

    // Otherwise, run each requested tool and append its output as a
    // `tool` message so the model sees the result on the next loop.
    for (const call of aiMsg.tool_calls) {
      console.log(`tool: ${call.name}(${JSON.stringify(call.args)})`);
      const t = toolsByName[call.name];
      if (!t) {
        // The model invented a tool name we don't have. Tell it.
        messages.push(
          new ToolMessage({
            content: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
            tool_call_id: call.id!,
          })
        );
        continue;
      }
      try {
        const result = await t.invoke(call.args as any);
        messages.push(
          new ToolMessage({
            content:
              typeof result === "string" ? result : JSON.stringify(result),
            tool_call_id: call.id!,
          })
        );
      } catch (err) {
        // If a tool throws (bad API call, validation, etc.), feed the
        // error back so the model can sometimes recover by retrying
        // with different arguments.
        messages.push(
          new ToolMessage({
            content: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            tool_call_id: call.id!,
          })
        );
      }
    }
  }

  sessions.set(sessionId, messages);
  return "I hit my step limit without reaching a final answer.";
}

// =============================================================
// 5. HTTP server
// =============================================================
// Express serves /public as static assets (the chat UI) and exposes
// two JSON endpoints the frontend posts to.
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Main endpoint: the browser sends a sessionId + message, we run the
// agent loop, and return the assistant's reply.
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof message !== "string") {
    return res
      .status(400)
      .json({ error: "Both `sessionId` and `message` are required strings." });
  }
  try {
    const reply = await chat(sessionId, message);
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
});

// Lets the user start a fresh conversation by clearing their history.
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId === "string") sessions.delete(sessionId);
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Chat server listening on http://localhost:${port}`);
});
