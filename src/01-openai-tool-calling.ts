/**
 * Lesson 1: Tool calling with the OpenAI SDK (no LangChain).
 *
 * Key idea: the model does NOT execute your function. It returns a
 * structured message saying "call this tool with these arguments."
 * Your code runs the function, feeds the result back as a `tool`
 * message, and the model then produces the final natural-language answer.
 *
 * The five-step loop every tool-calling system runs:
 *   1. Send user question + tool schemas to the model
 *   2. Model replies: either plain text OR a tool_call request
 *   3. Your code executes the requested function
 *   4. Append the function's output as a `tool` message
 *   5. Send the updated conversation back; model writes the final answer
 */
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI();

// -- 1. The real function we want the model to be able to trigger --
type Weather = { temperature_f: number; condition: string };

function fetchWeather(city: string): Weather {
  const db: Record<string, Weather> = {
    austin: { temperature_f: 88, condition: "sunny" },
    seattle: { temperature_f: 54, condition: "rainy" },
    "new york": { temperature_f: 62, condition: "cloudy" },
  };
  return db[city.toLowerCase()] ?? { temperature_f: 70, condition: "unknown" };
}

// -- 2. Describe the function in JSON Schema so the model knows it exists --
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_weather",
      description: "Get the current weather for a city.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "City name, e.g. 'Austin'",
          },
        },
        required: ["city"],
      },
    },
  },
];

async function run(userQuery: string): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: userQuery },
  ];

  // -- 3. First call: the model decides whether to use a tool --
  const first = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    tools,
  });

  const assistantMsg = first.choices[0].message;
  messages.push(assistantMsg);

  // If no tool was requested, the model already has its final answer.
  if (!assistantMsg.tool_calls?.length) {
    return assistantMsg.content ?? "";
  }

  // -- 4. Run each requested tool and record its output --
  for (const call of assistantMsg.tool_calls) {
    const args = JSON.parse(call.function.arguments) as { city: string };
    const result = fetchWeather(args.city);
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result),
    });
  }

  // -- 5. Second call: model turns the tool output into a final answer --
  const second = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  return second.choices[0].message.content ?? "";
}

const answer = await run("What's the weather in Austin right now?");
console.log(answer);
