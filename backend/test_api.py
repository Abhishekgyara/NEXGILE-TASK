import tempfile
import unittest
import os
from pathlib import Path

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite://"

from backend.database import Database
from backend.main import create_app


class RefundApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = Database(Path(self.temp_dir.name) / "test.sqlite")
        self.client = TestClient(create_app(self.db))

    def tearDown(self) -> None:
        self.client.close()
        self.db.engine.dispose()
        self.temp_dir.cleanup()

    def test_seed_world_and_findings(self) -> None:
        self.client.post(
            "/api/auth/signup",
            json={"name": "Demo User", "email": "demo@example.com", "password": "correct-horse-battery"},
        )
        world = self.client.get("/api/world")
        findings = self.client.get("/api/findings")
        self.assertEqual(world.status_code, 200)
        world_data = world.json()
        self.assertEqual(len(world_data["customers"]), 6)
        expected_tables = {
            "customers",
            "orders",
            "refunds",
            "providerTransactions",
            "ledgerEntries",
            "workerJobs",
            "workerLogs",
            "fxRates",
        }
        self.assertEqual(set(world_data), expected_tables)
        self.assertTrue(all(isinstance(world_data[key], list) for key in expected_tables))
        self.assertIn("MISSING_LEDGER", {item["kind"] for item in findings.json()})
        self.assertIn("DUPLICATE_REFUND", {item["kind"] for item in findings.json()})
        fx_finding = next(item for item in findings.json() if item["refundId"] == "REF1005")
        self.assertEqual(fx_finding["kind"], "AMOUNT_MISMATCH")
        self.assertEqual(fx_finding["providerMinor"], 11000)
        self.assertEqual(fx_finding["ledgerMinor"], 10500)
        self.assertEqual(fx_finding["differenceMinor"], 500)
        self.assertEqual(fx_finding["providerCurrency"], "EUR")
        self.assertEqual(fx_finding["ledgerCurrency"], "USD")
        preview_ack = self.client.post("/api/customers/C101/recovery/acknowledge")
        self.assertEqual(preview_ack.status_code, 201)
        acknowledged_log = next(
            item for item in self.client.get("/api/worker-logs", params={"search": "RECOVERY_PREVIEW_ACKNOWLEDGED"}).json()
            if item["event"] == "RECOVERY_PREVIEW_ACKNOWLEDGED"
        )
        self.assertEqual(acknowledged_log["createdAt"], preview_ack.json()["acknowledgedAt"])

    def test_refund_validation_and_transactional_processing(self) -> None:
        self.client.post(
            "/api/auth/signup",
            json={"name": "Refund User", "email": "refund@example.com", "password": "correct-horse-battery"},
        )
        invalid = self.client.post(
            "/api/refunds",
            json={"customerId": "C600", "orderId": "ORD1007", "amount": "999.00", "currency": "GBP"},
        )
        self.assertEqual(invalid.status_code, 422)

        created = self.client.post(
            "/api/refunds",
            json={"customerId": "C600", "orderId": "ORD1007", "amount": "12.34", "currency": "GBP"},
        )
        self.assertEqual(created.status_code, 201)
        refund = created.json()
        self.assertEqual(refund["amountMinor"], 1234)
        self.assertEqual(refund["status"], "PENDING")

        processed = self.client.post(f"/api/refunds/{refund['id']}/process")
        self.assertEqual(processed.status_code, 200)
        self.assertEqual(processed.json()["refund"]["status"], "PAID")
        self.assertEqual(len(processed.json()["providerTransactions"]), 1)
        self.assertEqual(len(processed.json()["ledgerEntries"]), 1)

        repeated = self.client.post(f"/api/refunds/{refund['id']}/process")
        self.assertEqual(repeated.status_code, 409)

    def test_reconciliation_simulation_and_reset(self) -> None:
        self.client.post(
            "/api/auth/signup",
            json={"name": "Ops User", "email": "ops@example.com", "password": "correct-horse-battery"},
        )
        reconciliation = self.client.post("/api/reconciliation/run")
        self.assertEqual(reconciliation.status_code, 200)
        self.assertGreater(reconciliation.json()["duplicateCount"], 0)
        self.assertEqual(reconciliation.json()["netDiscrepancyMinor"], 35000)

        original_world = self.client.get("/api/world").json()
        fixes = self.client.post("/api/fixes/run")
        self.assertEqual(fixes.status_code, 200)
        self.assertEqual(len(fixes.json()["check"]), 6)
        self.assertTrue(all(check["status"] == "PASS" for check in fixes.json()["check"]))
        self.assertEqual(fixes.json()["before"]["netDiscrepancyMinor"], 35000)
        self.assertEqual(fixes.json()["after"]["netDiscrepancyMinor"], 0)
        corrected_world = self.client.get("/api/world").json()
        self.assertEqual(original_world["providerTransactions"], corrected_world["providerTransactions"])
        self.assertEqual(original_world["ledgerEntries"], corrected_world["ledgerEntries"])

        source_provider = self.db.rows("SELECT * FROM provider_transactions ORDER BY id")
        source_ledger = self.db.rows("SELECT * FROM ledger_entries ORDER BY id")
        acknowledged = self.client.post("/api/fixes/acknowledge")
        self.assertEqual(acknowledged.status_code, 200)
        acknowledged_at = acknowledged.json()["acknowledgedAt"]
        self.assertIsNotNone(acknowledged_at)

        applied_world = self.client.get("/api/world").json()
        self.assertEqual(len(applied_world["providerTransactions"]), 6)
        self.assertEqual(len(applied_world["ledgerEntries"]), 6)
        repaired_fx_entry = next(item for item in applied_world["ledgerEntries"] if item["refundId"] == "REF1005")
        self.assertEqual(repaired_fx_entry["amountMinor"], 11000)
        self.assertEqual(repaired_fx_entry["currency"], "USD")
        self.assertEqual(repaired_fx_entry["updatedAt"], acknowledged_at)
        self.assertTrue(any(item["event"] == "FIX_APPLIED" and item["createdAt"] == acknowledged_at for item in applied_world["workerLogs"]))
        applied_reconciliation = self.client.get("/api/reconciliation").json()
        self.assertEqual(applied_reconciliation["netDiscrepancyMinor"], 0)
        self.assertEqual(applied_reconciliation["duplicateCount"], 0)
        self.assertEqual(applied_reconciliation["providerOnlyCount"], 0)
        self.assertEqual(self.client.get("/api/findings").json(), [])
        self.assertEqual(source_provider, self.db.rows("SELECT * FROM provider_transactions ORDER BY id"))
        self.assertEqual(source_ledger, self.db.rows("SELECT * FROM ledger_entries ORDER BY id"))

        reverted = self.client.post("/api/fixes/revert")
        self.assertEqual(reverted.status_code, 200)
        reverted_world = self.client.get("/api/world").json()
        self.assertEqual(original_world["providerTransactions"], reverted_world["providerTransactions"])
        self.assertEqual(original_world["ledgerEntries"], reverted_world["ledgerEntries"])
        self.assertEqual(self.client.get("/api/reconciliation").json()["netDiscrepancyMinor"], 35000)

        simulation = self.client.post("/api/simulations/missing_ledger")
        self.assertEqual(simulation.status_code, 200)
        self.assertEqual(simulation.json()["missingLedgerAmountMinor"], 12000)
        self.assertGreater(len(simulation.json()["events"]), 1)
        self.assertEqual(len(self.client.get("/api/simulations").json()), 1)

        reset = self.client.post("/api/reset")
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(self.client.get("/api/simulations").json(), [])
        self.assertIn("REF1007", {row["id"] for row in self.client.get("/api/world").json()["refunds"]})

    def test_auth_logout_and_user_owned_records(self) -> None:
        self.assertEqual(self.client.get("/api/world").status_code, 401)
        signup = self.client.post(
            "/api/auth/signup",
            json={"name": "Account One", "email": "one@example.com", "password": "correct-horse-battery"},
        )
        self.assertEqual(signup.status_code, 201)
        stored_user = self.db.row("SELECT password_hash FROM users WHERE email = ?", ("one@example.com",))
        self.assertNotIn("correct-horse-battery", stored_user["password_hash"])
        self.assertEqual(self.client.get("/api/auth/me").json()["email"], "one@example.com")

        customer = self.client.post(
            "/api/customers",
            json={"name": "My Customer", "email": "mycustomer@example.com", "currency": "USD"},
        )
        self.assertEqual(customer.status_code, 201)
        order = self.client.post(
            "/api/orders",
            json={"customerId": customer.json()["id"], "amount": "40.00", "currency": "USD"},
        )
        self.assertEqual(order.status_code, 201)
        refund = self.client.post(
            "/api/refunds",
            json={
                "customerId": customer.json()["id"],
                "orderId": order.json()["id"],
                "amount": "10.00",
                "currency": "USD",
            },
        )
        self.assertEqual(refund.status_code, 201)

        self.client.post("/api/auth/logout")
        self.assertEqual(self.client.get("/api/world").status_code, 401)
        login = self.client.post(
            "/api/auth/login",
            json={"email": "one@example.com", "password": "correct-horse-battery"},
        )
        self.assertEqual(login.status_code, 200)
        refreshed_world = self.client.get("/api/world").json()
        self.assertIn(customer.json()["id"], {row["id"] for row in refreshed_world["customers"]})
        self.assertIn(order.json()["id"], {row["id"] for row in refreshed_world["orders"]})

        self.client.post("/api/auth/logout")
        self.client.post(
            "/api/auth/signup",
            json={"name": "Account Two", "email": "two@example.com", "password": "another-secure-pass"},
        )
        second_user_world = self.client.get("/api/world").json()
        visible_ids = {row["id"] for row in second_user_world["customers"]}
        self.assertIn("C101", visible_ids)
        self.assertNotIn(customer.json()["id"], visible_ids)
        self.assertNotIn(order.json()["id"], {row["id"] for row in second_user_world["orders"]})
        self.assertEqual(self.client.get(f"/api/refunds/{refund.json()['id']}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
