-- CreateTable
CREATE TABLE "emitter" (
    "id" TEXT NOT NULL,
    "identification_type" TEXT NOT NULL,
    "identification" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade_name" TEXT,
    "activity_code" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "canton" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "other_signs" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "branch_code" TEXT NOT NULL DEFAULT '001',
    "terminal_code" TEXT NOT NULL DEFAULT '00001',
    "certificate_enc" BYTEA,
    "certificate_pin_enc" BYTEA,
    "api_user_enc" BYTEA,
    "api_password_enc" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emitter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequence" (
    "emitter_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "last_number" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "document_sequence_pkey" PRIMARY KEY ("emitter_id","document_type")
);

-- CreateTable
CREATE TABLE "api_client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "webhook_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_client_emitter" (
    "client_id" TEXT NOT NULL,
    "emitter_id" TEXT NOT NULL,

    CONSTRAINT "api_client_emitter_pkey" PRIMARY KEY ("client_id","emitter_id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "emitter_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "external_reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "consecutive" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "exchange_rate" DECIMAL(18,5) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "total" DECIMAL(18,5) NOT NULL,
    "total_tax" DECIMAL(18,5) NOT NULL,
    "status" TEXT NOT NULL,
    "hacienda_message" TEXT,
    "signed_xml" TEXT NOT NULL,
    "response_xml" TEXT,
    "referenced_id" TEXT,
    "receiver" JSONB,
    "lines" JSONB NOT NULL,
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "poll_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "webhook_pending" BOOLEAN NOT NULL DEFAULT false,
    "webhook_attempts" INTEGER NOT NULL DEFAULT 0,
    "webhook_next_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_client_name_key" ON "api_client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_client_key_hash_key" ON "api_client"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "document_key_key" ON "document"("key");

-- CreateIndex
CREATE INDEX "document_client_id_external_reference_idx" ON "document"("client_id", "external_reference");

-- CreateIndex
CREATE INDEX "document_status_next_attempt_at_idx" ON "document"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "document_webhook_pending_webhook_next_at_idx" ON "document"("webhook_pending", "webhook_next_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_client_id_idempotency_key_key" ON "document"("client_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "document_sequence" ADD CONSTRAINT "document_sequence_emitter_id_fkey" FOREIGN KEY ("emitter_id") REFERENCES "emitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_client_emitter" ADD CONSTRAINT "api_client_emitter_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_client_emitter" ADD CONSTRAINT "api_client_emitter_emitter_id_fkey" FOREIGN KEY ("emitter_id") REFERENCES "emitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_emitter_id_fkey" FOREIGN KEY ("emitter_id") REFERENCES "emitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_referenced_id_fkey" FOREIGN KEY ("referenced_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
