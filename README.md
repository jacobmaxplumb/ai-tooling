# AI Tooling — Tool Calling with OpenAI, LangChain, and LangSmith

Classroom companion repo for the "Tool Calling" lecture. TypeScript, no build step (run with `tsx`).

## Branches

| Branch  | What's in it                                                          |
| ------- | --------------------------------------------------------------------- |
| `start` | Lessons 1–3 are complete and runnable. Lesson 4 (homework) is stubs.  |
| `end`   | Everything, including the homework solutions.                         |

Students should check out `start`, walk through lessons 1–3 with the instructor, then complete the homework in `src/04-homework.ts`. Compare your solution against `end` when you're done.

## Prerequisites

- Node.js 18 or newer (`node --version`)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [LangSmith API key](https://smith.langchain.com) (free tier is plenty)

## Setup

```bash
git clone https://github.com/jacobmaxplumb/ai-tooling.git
cd ai-tooling
git checkout start

cp .env.sample .env
# open .env in your editor and paste your keys

npm install
```

## Running each lesson

```bash
npm run lesson:1    # OpenAI native tool calling (weather)
npm run lesson:2    # Same thing, rewritten in LangChain
npm run lesson:3    # Multi-tool agent traced in LangSmith
npm run homework    # The three exercises in src/04-homework.ts
```

After running lesson 3, open [smith.langchain.com](https://smith.langchain.com), select the project named in `LANGSMITH_PROJECT` (default: `ai-tooling-class`), and inspect the trace.

## The chat app

A browser chat UI that wires all five tools (weather, activity, quadratic, Fibonacci, FX) into a live agent loop. Type a question, the model picks a tool, the answer comes back. Every conversation still flows through LangSmith.

### Run locally

```bash
npm run server
# open http://localhost:3000
```

### Run with Docker

```bash
# .env must exist first — the container reads it at startup
docker compose up --build

# open http://localhost:3000
# Ctrl-C to stop; `docker compose down` to remove the container
```

Sessions live in the server's memory; restarting the container (or running `Reset` in the UI) clears them.

## What's in each file

```
src/
├── 01-openai-tool-calling.ts      OpenAI SDK, hand-written JSON schema
├── 02-langchain-tool-calling.ts   LangChain tool() + Zod schema + bindTools
├── 03-langsmith-observability.ts  Multi-tool agent loop; traces auto-sent
├── 04-homework.ts                 Build: quadratic solver, Fibonacci, FX
└── server.ts                      Express + chat endpoint wiring all tools

public/
└── index.html                     Minimal chat UI (vanilla HTML/CSS/JS)

Dockerfile, docker-compose.yml     Containerized chat app
```

## The lecture itself

Read [`LECTURE.md`](./LECTURE.md) for the full instructor script — concepts, code walkthroughs, LangSmith deep dive, and homework framing.
