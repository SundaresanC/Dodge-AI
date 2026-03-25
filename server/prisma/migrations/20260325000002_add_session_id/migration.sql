-- AlterTable: add session_id column to graph_chat_history
ALTER TABLE "graph_chat_history" ADD COLUMN "session_id" TEXT NOT NULL DEFAULT 'default';

-- Remove the default after backfilling
ALTER TABLE "graph_chat_history" ALTER COLUMN "session_id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "graph_chat_history_user_id_session_id_idx" ON "graph_chat_history"("user_id", "session_id");
