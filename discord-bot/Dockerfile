# ── Stage 1 : Compile the bot to a self-contained binary ─────────────────────
FROM oven/bun:1-alpine AS builder

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN [ -f src/messages.ts ] || cp src/messages.example.ts src/messages.ts

RUN bun build ./src/index.ts --compile --outfile=bot

# ── Stage 2 : Minimal runtime image ──────────────────────────────────────────
FROM oven/bun:1-alpine

WORKDIR /app
COPY --from=builder /app/bot ./bot

CMD ["/app/bot"]
