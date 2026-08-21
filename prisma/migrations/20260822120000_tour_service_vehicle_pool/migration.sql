-- TOUR-VEHICLE-1 — the relational pool of a TOUR service's eligible provider Vehicles.
--
-- ADDITIVE / LEGACY-SAFE ONLY. One brand-new join table; no existing row is touched.
--   * existing services start with ZERO pool rows (no backfill).
--   * composite PK (serviceId, vehicleId) makes a duplicate add a DB no-op.
--   * FK to services cascades (pool config is meaningless without its service);
--     FK to vehicles is RESTRICT (a pooled vehicle must not silently vanish from a
--     configured tour).
-- No DROP, no DELETE, no UPDATE of existing rows, no enum change, no AssetStatus /
-- Booking / Service / ProviderCategory / guidingContent mutation. NOT applied by this
-- gate (local only).

-- CreateTable
CREATE TABLE "tour_service_vehicles" (
    "serviceId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_service_vehicles_pkey" PRIMARY KEY ("serviceId","vehicleId")
);

-- CreateIndex
CREATE INDEX "tour_service_vehicles_vehicleId_idx" ON "tour_service_vehicles"("vehicleId");

-- AddForeignKey
ALTER TABLE "tour_service_vehicles" ADD CONSTRAINT "tour_service_vehicles_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_service_vehicles" ADD CONSTRAINT "tour_service_vehicles_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
