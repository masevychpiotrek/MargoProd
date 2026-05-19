-- Migracja 005: Zlecenia produkcyjne
-- Uruchom w Supabase SQL Editor

CREATE TYPE order_status AS ENUM ('active', 'paused', 'completed', 'cancelled');

CREATE TABLE production_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number    TEXT NOT NULL,          -- Z/01/05/26
  machine_id      UUID NOT NULL REFERENCES machines(id),
  target_qty      INT NOT NULL DEFAULT 0, -- wielkość zlecenia
  produced_qty    INT NOT NULL DEFAULT 0, -- wyprodukowane łącznie
  status          order_status NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      UUID REFERENCES profiles(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Powiązanie raportu godzinowego ze zleceniem
ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES production_orders(id),
  ADD COLUMN IF NOT EXISTS order_qty INT DEFAULT 0; -- ile sztuk z tej godziny idzie na zlecenie

-- Indeksy
CREATE INDEX idx_orders_machine   ON production_orders(machine_id);
CREATE INDEX idx_orders_status    ON production_orders(status);
CREATE INDEX idx_orders_number    ON production_orders(order_number);
CREATE INDEX idx_reports_order    ON hourly_reports(order_id);

-- Trigger: aktualizuj produced_qty w zleceniu po każdym raporcie
CREATE OR REPLACE FUNCTION update_order_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    UPDATE production_orders
    SET produced_qty = (
      SELECT COALESCE(SUM(order_qty), 0)
      FROM hourly_reports
      WHERE order_id = NEW.order_id
        AND deleted_at IS NULL
    ),
    updated_at = NOW()
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_order_qty
  AFTER INSERT OR UPDATE ON hourly_reports
  FOR EACH ROW EXECUTE FUNCTION update_order_qty();

-- RLS
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_read"   ON production_orders FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "orders_insert" ON production_orders FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "orders_update" ON production_orders FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Trigger updated_at
CREATE TRIGGER trg_orders_updated
  BEFORE UPDATE ON production_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
