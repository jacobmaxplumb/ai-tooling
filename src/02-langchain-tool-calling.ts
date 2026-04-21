/**
 * Lesson 2: Tool calling with LangChain.
 *
 * Same five-step loop as lesson 1, but LangChain hides the JSON-Schema
 * boilerplate and the message-shape nitpicks. You:
 *
 *   - declare the tool's argument shape with Zod
 *   - write the implementation as a normal async function
 *   - call `llm.bindTools([...])` to attach them
 *   - invoke the model with plain message objects
 *
 * The `description` you pass to `tool()` is what the model reads to
 * decide when to call it. Treat it like a short spec — the better it is,
 * the less the model guesses.
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
    schema: z.object({
      city: z.string().describe("City name, e.g. 'Austin'"),
    }),
  }
);

const toolsByName = { fetch_weather: fetchWeather } as const;

const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
const llmWithTools = llm.bindTools([fetchWeather]);

async function run(userQuery: string) {
  const messages: BaseMessage[] = [new HumanMessage(userQuery)];

  const aiMsg = await llmWithTools.invoke(messages);
  messages.push(aiMsg);

  if (!aiMsg.tool_calls?.length) {
    return aiMsg.content;
  }

  for (const call of aiMsg.tool_calls) {
    const t = toolsByName[call.name as keyof typeof toolsByName];
    const result = await t.invoke(call.args as any);
    messages.push(
      new ToolMessage({
        content:
          typeof result === "string" ? result : JSON.stringify(result),
        tool_call_id: call.id!,
      })
    );
  }

  const final = await llmWithTools.invoke(messages);
  return final.content;
}

console.log(await run("What's the weather in Seattle?"));
