/**
 * Lesson 3: Observability with LangSmith.
 *
 * No new code is required to enable tracing — LangChain auto-reports
 * every LLM call and tool execution to LangSmith when these env vars
 * are set:
 *
 *     LANGSMITH_TRACING=true
 *     LANGSMITH_API_KEY=lsv2_...
 *     LANGSMITH_PROJECT=ai-tooling-class
 *
 * Why this lesson looks different from lesson 2:
 * We now have TWO tools and loop until the model stops asking for tools.
 * That gives you an interesting multi-step trace to inspect in the UI.
 *
 * After running this file, open https://smith.langchain.com, select the
 * project from LANGSMITH_PROJECT, and look for:
 *   - the top-level run for the whole invocation
 *   - each ChatOpenAI call nested inside
 *   - each tool call (fetch_weather, recommend_activity) nested further
 *   - latency, token counts, and the full input/output of every step
 */
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

const fetchWeather = tool(
  async ({ city }) => {
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
      "Recommend an activity given a weather condition. Valid conditions: 'sunny', 'rainy', 'cloudy'.",
    schema: z.object({ condition: z.string() }),
  }
);

const tools = [fetchWeather, recommendActivity];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
const llmWithTools = llm.bindTools(tools);

async function run(userQuery: string, maxSteps = 5) {
  const messages: BaseMessage[] = [new HumanMessage(userQuery)];

  for (let step = 0; step < maxSteps; step++) {
    const aiMsg = await llmWithTools.invoke(messages);
    messages.push(aiMsg);

    if (!aiMsg.tool_calls?.length) {
      return aiMsg.content;
    }

    for (const call of aiMsg.tool_calls) {
      const t = toolsByName[call.name];
      const result = await t.invoke(call.args as any);
      messages.push(
        new ToolMessage({
          content:
            typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: call.id!,
        })
      );
    }
  }

  return "Hit max steps without a final answer.";
}

console.log(await run("I'm in Austin today. What should I do?"));
