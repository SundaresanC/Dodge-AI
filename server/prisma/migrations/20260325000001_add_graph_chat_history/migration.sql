-- CreateTable: graph_chat_history
-- Persists all O2C Graph chat exchanges per user (FlowMind AI graph chat).

CREATE TABLE "graph_chat_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'AGGREGATE',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "highlight_nodes" JSONB NOT NULL DEFAULT '[]',
    "entities_involved" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_chat_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: fast lookup by user + date (newest-first queries)
CREATE INDEX "graph_chat_history_user_id_created_at_idx"
    ON "graph_chat_history"("user_id", "created_at");

-- AddForeignKey: cascade delete when user is removed
ALTER TABLE "graph_chat_history"
    ADD CONSTRAINT "graph_chat_history_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
