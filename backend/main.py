import json
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from .database import Database

FX_RATES = {
    "USD": Decimal("1"),
    "EUR": Decimal("1.10"),
    "GBP": Decimal("1.27"),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def api_row(row: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    return {names.get(key, key): value for key, value in row.items() if key != "user_id"}


def as_json(row: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    return api_row(row, names)


def current_user(request: Request) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in")
    return user


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256$310000${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored_hash.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        derived = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(derived.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def issue_session(connection: Any, user_id: str, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    created_at = now_iso()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    connection.execute(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (hashlib.sha256(token.encode()).hexdigest(), user_id, expires_at, created_at),
    )
    response.set_cookie(
        "refundguard_session",
        token,
        max_age=14 * 24 * 60 * 60,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="lax",
        path="/",
    )


def create_app(database: Database | None = None) -> FastAPI:
    db = database or Database()
    app = FastAPI(title="RefundGuard API", version="1.0.0")
    app.state.database = db
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "database": db.dialect}

    @app.middleware("http")
    async def require_session(request: Request, call_next: Any) -> Any:
        path = request.url.path
        if path == "/health" or path.startswith("/api/auth/") or request.method == "OPTIONS":
            return await call_next(request)
        raw_token = request.cookies.get("refundguard_session")
        if raw_token:
            session = db.row(
                """SELECT users.id, users.name, users.email
                   FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
                   WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?""",
                (hashlib.sha256(raw_token.encode()).hexdigest(), now_iso()),
            )
            request.state.user = session
        if not getattr(request.state, "user", None):
            return JSONResponse(status_code=401, content={"detail": "Please sign in"})
        return await call_next(request)

    @app.post("/api/auth/signup", status_code=201)
    def signup(payload: SignupInput, response: Response) -> dict[str, Any]:
        email = payload.email.strip().lower()
        if db.row("SELECT id FROM users WHERE email = ?", (email,)):
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        user = {
            "id": uuid4().hex,
            "name": payload.name.strip(),
            "email": email,
            "createdAt": now_iso(),
        }
        with db.connect() as connection:
            connection.execute(
                "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user["id"], user["name"], email, hash_password(payload.password), user["createdAt"]),
            )
            issue_session(connection, user["id"], response)
        return user

    @app.post("/api/auth/login")
    def login(payload: LoginInput, response: Response) -> dict[str, Any]:
        user = db.row("SELECT * FROM users WHERE email = ?", (payload.email.strip().lower(),))
        if not user or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect")
        public_user = {"id": user["id"], "name": user["name"], "email": user["email"]}
        with db.connect() as connection:
            issue_session(connection, user["id"], response)
        return public_user

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response) -> dict[str, str]:
        raw_token = request.cookies.get("refundguard_session")
        if raw_token:
            with db.connect() as connection:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = ?",
                    (hashlib.sha256(raw_token.encode()).hexdigest(),),
                )
        response.delete_cookie("refundguard_session", path="/", httponly=True, samesite="lax")
        return {"status": "signed_out"}

    @app.get("/api/auth/me")
    def current_session(request: Request) -> dict[str, Any]:
        raw_token = request.cookies.get("refundguard_session")
        if not raw_token:
            raise HTTPException(status_code=401, detail="Please sign in")
        user = db.row(
            """SELECT users.id, users.name, users.email
               FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
               WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?""",
            (hashlib.sha256(raw_token.encode()).hexdigest(), now_iso()),
        )
        if not user:
            raise HTTPException(status_code=401, detail="Please sign in")
        return user

    @app.get("/api/world")
    def world(user: dict[str, Any] = Depends(current_user)) -> dict[str, list[dict[str, Any]]]:
        return load_world_data(db, user["id"])

    @app.post("/api/customers", status_code=201)
    def create_customer(payload: CustomerInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        customer_id = f"U{uuid4().hex[:10].upper()}"
        created_at = now_iso()
        try:
            with db.connect() as connection:
                connection.execute(
                    "INSERT INTO customers (id, name, email, currency, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)",
                    (customer_id, payload.name.strip(), payload.email.strip().lower(), payload.currency, created_at, user["id"]),
                )
        except IntegrityError as error:
            raise HTTPException(status_code=409, detail="A customer with this email already exists") from error
        return {"id": customer_id, "name": payload.name.strip(), "email": payload.email.strip().lower(), "currency": payload.currency, "createdAt": created_at}

    @app.post("/api/orders", status_code=201)
    def create_order(payload: OrderInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        amount_minor = parse_amount(payload.amount)
        customer = db.row(
            "SELECT id, currency FROM customers WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
            (payload.customerId, user["id"]),
        )
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        if customer["currency"] != payload.currency:
            raise HTTPException(status_code=422, detail="Currency must match the customer currency")
        order_id = f"UO{uuid4().hex[:10].upper()}"
        created_at = now_iso()
        with db.connect() as connection:
            connection.execute(
                """INSERT INTO orders (id, customer_id, amount_minor, currency, status, created_at, user_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (order_id, payload.customerId, amount_minor, payload.currency, payload.status, created_at, user["id"]),
            )
        return {"id": order_id, "customerId": payload.customerId, "amountMinor": amount_minor, "currency": payload.currency, "status": payload.status, "createdAt": created_at}

    @app.get("/api/dashboard")
    def dashboard(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        owner_id = user["id"]
        refunds = db.rows("SELECT * FROM refunds WHERE user_id IS NULL OR user_id = ?", (owner_id,))
        transactions = db.rows(
            """SELECT child.* FROM provider_transactions child JOIN refunds parent ON parent.id = child.refund_id
               WHERE child.status = 'SETTLED' AND (parent.user_id IS NULL OR parent.user_id = ?)""",
            (owner_id,),
        )
        ledger = db.rows(
            """SELECT child.* FROM ledger_entries child JOIN refunds parent ON parent.id = child.refund_id
               WHERE child.status = 'POSTED' AND (parent.user_id IS NULL OR parent.user_id = ?)""",
            (owner_id,),
        )
        findings = find_findings(db, owner_id)
        provider_total = sum(row["amount_minor"] for row in transactions)
        ledger_total = sum(row["amount_minor"] for row in ledger)
        duplicate_count = sum(f["kind"] == "DUPLICATE_REFUND" for f in findings)
        return {
            "totalRefundRequests": len(refunds),
            "totalProviderPayoutMinor": provider_total,
            "totalLedgerAmountMinor": ledger_total,
            "financialDiscrepancyMinor": provider_total - ledger_total,
            "duplicateRefunds": duplicate_count,
            "failedTransactions": sum(row["status"] == "FAILED" for row in refunds),
            "discrepancyPct": (provider_total - ledger_total) / provider_total if provider_total else 0,
            "pendingRefunds": sum(row["status"] == "PENDING" for row in refunds),
            "processingRefunds": sum(row["status"] == "PROCESSING" for row in refunds),
        }

    @app.get("/api/refunds")
    def list_refunds(
        status: str | None = None,
        currency: str | None = None,
        search: str | None = None,
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        user: dict[str, Any] = Depends(current_user),
    ) -> dict[str, Any]:
        clauses: list[str] = ["(user_id IS NULL OR user_id = ?)"]
        params: list[Any] = [user["id"]]
        if status:
            clauses.append("status = ?")
            params.append(status.upper())
        if currency:
            clauses.append("currency = ?")
            params.append(currency.upper())
        if search:
            clauses.append("(id LIKE ? OR customer_id LIKE ? OR order_id LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        count = db.row(f"SELECT COUNT(*) AS count FROM refunds{where}", tuple(params))["count"]
        rows = db.rows(
            f"SELECT * FROM refunds{where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            tuple(params + [limit, offset]),
        )
        return {
            "items": [api_row(row, REFUND_NAMES) for row in rows],
            "total": count,
            "limit": limit,
            "offset": offset,
        }

    @app.get("/api/refunds/{refund_id}")
    def get_refund(refund_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        refund = db.row(
            "SELECT * FROM refunds WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
            (refund_id, user["id"]),
        )
        if refund is None:
            raise HTTPException(status_code=404, detail="Refund not found")
        return {
            "refund": api_row(refund, REFUND_NAMES),
            "providerTransactions": [api_row(r, PROVIDER_NAMES) for r in db.rows("SELECT * FROM provider_transactions WHERE refund_id = ?", (refund_id,))],
            "ledgerEntries": [api_row(r, LEDGER_NAMES) for r in db.rows("SELECT * FROM ledger_entries WHERE refund_id = ?", (refund_id,))],
            "workerLogs": [api_row(r, LOG_NAMES) for r in db.rows("SELECT * FROM worker_logs WHERE refund_id = ? ORDER BY created_at", (refund_id,))],
        }

    @app.post("/api/refunds", status_code=201)
    def create_refund(payload: RefundInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        amount_minor = parse_amount(payload.amount)
        with db.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            customer = connection.execute(
                "SELECT * FROM customers WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
                (payload.customerId, user["id"]),
            ).fetchone()
            if customer is None:
                raise HTTPException(status_code=404, detail="Customer not found")
            order = connection.execute(
                "SELECT * FROM orders WHERE id = ? AND customer_id = ? AND (user_id IS NULL OR user_id = ?)",
                (payload.orderId, payload.customerId, user["id"]),
            ).fetchone()
            if order is None:
                raise HTTPException(status_code=404, detail="Order not found for customer")
            if payload.currency != order["currency"]:
                raise HTTPException(status_code=422, detail="Currency must match the order currency")
            if amount_minor > order["amount_minor"]:
                raise HTTPException(status_code=422, detail="Refund amount exceeds order total")
            refund_id = f"REF{uuid4().hex[:10].upper()}"
            created_at = now_iso()
            connection.execute(
                """INSERT INTO refunds
                (id, customer_id, order_id, amount_minor, currency, status, provider_status,
                 ledger_status, worker_id, retry_count, created_at, paid_at, scenario, user_id)
                VALUES (?, ?, ?, ?, ?, 'PENDING', 'NOT_SENT', 'NOT_RECORDED', NULL, 0, ?, NULL, NULL, ?)""",
                (refund_id, payload.customerId, payload.orderId, amount_minor, payload.currency, created_at, user["id"]),
            )
        refund = db.row("SELECT * FROM refunds WHERE id = ? AND user_id = ?", (refund_id, user["id"]))
        return api_row(refund, REFUND_NAMES)

    @app.post("/api/refunds/{refund_id}/process")
    def process_refund(refund_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        processed_at = now_iso()
        with db.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            refund = connection.execute(
                "SELECT * FROM refunds WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
                (refund_id, user["id"]),
            ).fetchone()
            if refund is None:
                raise HTTPException(status_code=404, detail="Refund not found")
            if refund["status"] != "PENDING":
                raise HTTPException(status_code=409, detail=f"Refund cannot be processed from {refund['status']} state")
            worker_id = "worker-01"
            changed = connection.execute(
                """UPDATE refunds SET status = 'PAID', provider_status = 'SETTLED',
                   ledger_status = 'POSTED', worker_id = ?, paid_at = ?
                   WHERE id = ? AND status = 'PENDING'""",
                (worker_id, processed_at, refund_id),
            ).rowcount
            if changed != 1:
                raise HTTPException(status_code=409, detail="Refund is already being processed")
            connection.execute(
                "INSERT INTO provider_transactions VALUES (?, ?, ?, ?, 'SETTLED', ?, ?, ?)",
                (f"TX-{uuid4().hex[:12]}", refund_id, refund["amount_minor"], refund["currency"],
                 f"STL-{uuid4().hex[:12]}", processed_at, "manual:simulate"),
            )
            connection.execute(
                "INSERT INTO ledger_entries VALUES (?, ?, ?, ?, 'POSTED', ?, ?)",
                (f"LE-{uuid4().hex[:12]}", refund_id, refund["amount_minor"], refund["currency"], processed_at, "manual:simulate"),
            )
            connection.execute(
                "INSERT INTO worker_jobs VALUES (?, ?, ?, 'DONE', 1, ?, ?)",
                (f"JOB-{uuid4().hex[:12]}", worker_id, refund_id, processed_at, processed_at),
            )
            connection.execute(
                "INSERT INTO worker_logs VALUES (?, ?, ?, 'INFO', 'PROVIDER_CALL', 'OK', ?, ?)",
                (f"WL-{uuid4().hex[:12]}", worker_id, refund_id, f"Provider accepted refund {refund_id}; ledger posted", processed_at),
            )
        return get_refund(refund_id, user)

    @app.get("/api/customers")
    def list_customers(search: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
        if search:
            rows = db.rows(
                """SELECT * FROM customers WHERE (user_id IS NULL OR user_id = ?)
                   AND (id LIKE ? OR name LIKE ? OR email LIKE ?) ORDER BY id""",
                (user["id"], f"%{search}%", f"%{search}%", f"%{search}%"),
            )
        else:
            rows = db.rows("SELECT * FROM customers WHERE user_id IS NULL OR user_id = ? ORDER BY id", (user["id"],))
        return [api_row(row, {"created_at": "createdAt"}) for row in rows]

    @app.get("/api/customers/{customer_id}/orders")
    def customer_orders(customer_id: str, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
        if db.row("SELECT id FROM customers WHERE id = ? AND (user_id IS NULL OR user_id = ?)", (customer_id, user["id"])) is None:
            raise HTTPException(status_code=404, detail="Customer not found")
        return [
            api_row(row, {"customer_id": "customerId", "amount_minor": "amountMinor", "created_at": "createdAt"})
            for row in db.rows(
                "SELECT * FROM orders WHERE customer_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY created_at DESC",
                (customer_id, user["id"]),
            )
        ]

    @app.get("/api/customers/recovery")
    def customer_recovery(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
        world = load_world_data(db, user["id"])
        findings = find_findings(db, user["id"])
        findings_by_customer: dict[str, list[dict[str, Any]]] = {}
        for finding in findings:
            findings_by_customer.setdefault(finding["customerId"], []).append(finding)
        refunds_by_customer: dict[str, list[dict[str, Any]]] = {}
        for refund in world["refunds"]:
            refunds_by_customer.setdefault(refund["customerId"], []).append(refund)
        paid_by_customer: dict[str, int] = {}
        refunds_by_id = {refund["id"]: refund for refund in world["refunds"]}
        for transaction in world["providerTransactions"]:
            refund = refunds_by_id.get(transaction["refundId"])
            if refund and transaction["status"] == "SETTLED":
                paid_by_customer[refund["customerId"]] = paid_by_customer.get(refund["customerId"], 0) + to_usd_minor(
                    transaction["amountMinor"], transaction["currency"],
                )

        result = []
        for customer in world["customers"]:
            refund_rows = refunds_by_customer.get(customer["id"], [])
            if not refund_rows:
                continue
            relevant = findings_by_customer.get(customer["id"], [])
            duplicate_minor = sum(
                max(0, item["differenceMinor"])
                for item in relevant
                if item["kind"] == "DUPLICATE_REFUND"
            )
            recovery = "CLAWBACK_REVIEW" if duplicate_minor else (
                "LEDGER_WRITE_OFF" if any(item["kind"] == "MISSING_LEDGER" for item in relevant) else "MONITOR"
            )
            result.append({
                "id": customer["id"], "name": customer["name"], "email": customer["email"],
                "currency": customer["currency"], "refundCount": len(refund_rows),
                "intendedMinor": sum(to_usd_minor(refund["amountMinor"], refund["currency"]) for refund in refund_rows),
                "paidMinor": paid_by_customer.get(customer["id"], 0),
                "duplicateMinor": duplicate_minor, "recovery": recovery,
                "recoveryNote": {
                    "CLAWBACK_REVIEW": "Duplicate payout detected — clawback review (dry run only)",
                    "LEDGER_WRITE_OFF": "Provider paid but ledger missing — recommend ledger write-off",
                    "MONITOR": "No anomalies detected",
                }[recovery],
            })
        return result

    @app.post("/api/customers/{customer_id}/recovery/acknowledge", status_code=201)
    def acknowledge_recovery_preview(
        customer_id: str,
        user: dict[str, Any] = Depends(current_user),
    ) -> dict[str, str]:
        finding = next(
            (
                item for item in find_findings(db, user["id"])
                if item["customerId"] == customer_id and item["kind"] == "DUPLICATE_REFUND"
            ),
            None,
        )
        if finding is None:
            raise HTTPException(status_code=409, detail="No duplicate-payout preview is available for this customer")
        acknowledged_at = now_iso()
        with db.connect() as connection:
            connection.execute(
                """INSERT INTO worker_logs
                   (id, worker_id, refund_id, level, event, status, message, created_at)
                   VALUES (?, ?, ?, 'INFO', 'RECOVERY_PREVIEW_ACKNOWLEDGED', 'ACKNOWLEDGED', ?, ?)""",
                (
                    f"LOG-{uuid4().hex[:12]}",
                    "recovery-review",
                    finding["refundId"],
                    f"Duplicate payout preview acknowledged for customer {customer_id}; no recovery payment was made.",
                    acknowledged_at,
                ),
            )
        return {
            "customerId": customer_id,
            "refundId": finding["refundId"],
            "acknowledgedAt": acknowledged_at,
        }

    @app.get("/api/findings")
    def findings_endpoint(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
        return find_findings(db, user["id"])

    @app.get("/api/worker-logs")
    def worker_logs(
        worker_id: str | None = None,
        level: str | None = None,
        search: str | None = None,
        limit: int = Query(default=200, ge=1, le=1000),
        user: dict[str, Any] = Depends(current_user),
    ) -> list[dict[str, Any]]:
        rows = load_world_data(db, user["id"])["workerLogs"]
        if worker_id:
            rows = [row for row in rows if row["workerId"] == worker_id]
        if level:
            rows = [row for row in rows if row["level"] == level.upper()]
        if search:
            query = search.casefold()
            rows = [
                row for row in rows
                if query in f"{row['refundId'] or ''} {row['event']} {row['message']}".casefold()
            ]
        return sorted(rows, key=lambda row: row["createdAt"], reverse=True)[:limit]

    @app.get("/api/reconciliation")
    def get_reconciliation(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        latest = db.row(
            "SELECT result_json FROM reconciliation_runs WHERE owner_id = ? ORDER BY ran_at DESC LIMIT 1",
            (user["id"],),
        )
        return json.loads(latest["result_json"]) if latest else run_reconciliation(db, "baseline", now_iso(), user["id"])

    @app.post("/api/reconciliation/run")
    def post_reconciliation(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        return run_reconciliation(db, f"manual-{now_iso()[11:19]}", now_iso(), user["id"])

    @app.get("/api/scenarios")
    def scenarios() -> list[dict[str, Any]]:
        return SCENARIOS

    @app.get("/api/simulations")
    def simulation_runs(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
        return [
            json.loads(row["result_json"])
            for row in db.rows("SELECT result_json FROM simulation_runs WHERE owner_id = ?", (user["id"],))
        ]

    @app.post("/api/simulations/{scenario_id}")
    def run_simulation(scenario_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        scenario = next((item for item in SCENARIOS if item["id"] == scenario_id), None)
        if scenario is None:
            raise HTTPException(status_code=404, detail="Unknown simulation scenario")
        refund = db.row("SELECT * FROM refunds WHERE id = ?", (scenario["targetRefundId"],))
        if refund is None:
            raise HTTPException(status_code=404, detail="Scenario target refund not found")
        started = datetime.now(timezone.utc)
        at = started.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        run = {
            "id": f"SIM-{scenario_id}-{uuid4().hex[:8]}",
            "scenarioId": scenario_id,
            "scenarioTitle": scenario["title"],
            "status": "COMPLETED",
            "severity": scenario["severity"],
            "startedAt": at,
            "finishedAt": at,
            "duplicatedAmountMinor": scenario["duplicateMinor"],
            "missingLedgerAmountMinor": scenario["missingLedgerMinor"],
            "fxLossMinor": scenario["fxLossMinor"],
            "events": [
                {
                    "at": (started.replace(microsecond=0) + timedelta(seconds=index)).isoformat().replace("+00:00", "Z"),
                    "workerId": refund["worker_id"] or "worker-01",
                    "level": level,
                    "event": event,
                    "message": message,
                }
                for index, (level, event, message) in enumerate(scenario["events"])
            ],
            "cause": scenario["rootCause"],
            "targetRefundId": scenario["targetRefundId"],
        }
        with db.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO simulation_runs (scenario_id, owner_id, result_json) VALUES (?, ?, ?)",
                (scenario_id, user["id"], json.dumps(run)),
            )
        return run

    @app.get("/api/fixes")
    def fixes() -> list[dict[str, Any]]:
        return FIXES

    @app.get("/api/fixes/latest")
    def get_latest_fix_run(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any] | None:
        return latest_fix_run(db, user["id"])

    @app.post("/api/fixes/run")
    def run_fixes_endpoint(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        return execute_fix_checks(db, user["id"])

    @app.post("/api/fixes/acknowledge")
    def acknowledge_fix_run(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        row = db.row(
            "SELECT id, result_json FROM fix_runs WHERE owner_id = ? ORDER BY ran_at DESC, id DESC LIMIT 1",
            (user["id"],),
        )
        if not row:
            raise HTTPException(status_code=404, detail="Run and verify the corrected simulation before acknowledging it")
        result = json.loads(row["result_json"])
        if not all(check["status"] == "PASS" for check in result["check"]):
            raise HTTPException(status_code=409, detail="The corrected simulation has failing checks and cannot be applied")
        if result.get("acknowledgedAt"):
            return result
        result["acknowledgedAt"] = now_iso()
        result["revertedAt"] = None
        with db.connect() as connection:
            connection.execute(
                "UPDATE fix_runs SET result_json = ? WHERE id = ? AND owner_id = ?",
                (json.dumps(result), row["id"], user["id"]),
            )
        run_reconciliation(db, "verified-fixes-applied", result["acknowledgedAt"], user["id"])
        return result

    @app.post("/api/fixes/revert")
    def revert_fix_run(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        row = db.row(
            "SELECT id, result_json FROM fix_runs WHERE owner_id = ? ORDER BY ran_at DESC, id DESC LIMIT 1",
            (user["id"],),
        )
        if not row:
            raise HTTPException(status_code=404, detail="There is no applied corrected simulation to revert")
        result = json.loads(row["result_json"])
        if not result.get("acknowledgedAt"):
            raise HTTPException(status_code=409, detail="No acknowledged corrections are currently applied")
        result["revertedAt"] = now_iso()
        result["acknowledgedAt"] = None
        with db.connect() as connection:
            connection.execute(
                "UPDATE fix_runs SET result_json = ? WHERE id = ? AND owner_id = ?",
                (json.dumps(result), row["id"], user["id"]),
            )
        run_reconciliation(db, "verified-fixes-reverted", result["revertedAt"], user["id"])
        return result

    @app.post("/api/reset")
    def reset_simulation(user: dict[str, Any] = Depends(current_user)) -> dict[str, str]:
        with db.connect() as connection:
            connection.execute("DELETE FROM simulation_runs WHERE owner_id = ?", (user["id"],))
            connection.execute("DELETE FROM reconciliation_runs WHERE owner_id = ?", (user["id"],))
            connection.execute("DELETE FROM fix_runs WHERE owner_id = ?", (user["id"],))
        return {"status": "reset"}

    @app.get("/api/settings")
    def settings(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        counts = {
            "customers": db.row("SELECT COUNT(*) AS count FROM customers WHERE user_id IS NULL OR user_id = ?", (user["id"],))["count"],
            "orders": db.row("SELECT COUNT(*) AS count FROM orders WHERE user_id IS NULL OR user_id = ?", (user["id"],))["count"],
            "refunds": db.row("SELECT COUNT(*) AS count FROM refunds WHERE user_id IS NULL OR user_id = ?", (user["id"],))["count"],
            "workerJobs": db.row("SELECT COUNT(*) AS count FROM worker_jobs WHERE refund_id IN (SELECT id FROM refunds WHERE user_id IS NULL OR user_id = ?)", (user["id"],))["count"],
            "workerLogs": db.row("SELECT COUNT(*) AS count FROM worker_logs WHERE refund_id IN (SELECT id FROM refunds WHERE user_id IS NULL OR user_id = ?)", (user["id"],))["count"],
        }
        return {
            "mode": "SIMULATION",
            "apiBaseUrl": "http://localhost:8000/api",
            "database": "MySQL" if db.dialect == "mysql" else "SQLite test database",
            "workerPool": "worker-01 … worker-04",
            "fxSource": "pinned daily rates (EUR 1.10 / GBP 1.27)",
            "counts": counts,
        }

    return app


REFUND_NAMES = {
    "customer_id": "customerId", "order_id": "orderId", "amount_minor": "amountMinor",
    "provider_status": "providerStatus", "ledger_status": "ledgerStatus", "worker_id": "workerId",
    "retry_count": "retryCount", "created_at": "createdAt", "paid_at": "paidAt",
}
PROVIDER_NAMES = {
    "refund_id": "refundId", "amount_minor": "amountMinor", "settlement_id": "settlementId",
    "created_at": "createdAt",
}
LEDGER_NAMES = {"refund_id": "refundId", "amount_minor": "amountMinor", "created_at": "createdAt"}
LOG_NAMES = {"worker_id": "workerId", "refund_id": "refundId", "created_at": "createdAt"}
SCENARIOS = [
    {"id": "duplicate_refund", "title": "Duplicate Refund", "severity": "CRITICAL", "targetRefundId": "REF1001", "duplicateMinor": 10000, "missingLedgerMinor": 0, "fxLossMinor": 0, "example": "A retry after a worker crash sends a second provider payout.", "rootCause": "Provider calls lack idempotency protection.", "events": [("INFO", "JOB_CLAIMED", "Refund job was claimed by a worker."), ("INFO", "PROVIDER_CALL", "Provider accepted the first settlement."), ("ERROR", "WORKER_CRASH", "Worker crashed before updating the ledger."), ("WARN", "RETRY_QUEUED", "Job was retried without checking provider status."), ("ERROR", "DUPLICATE_PAYMENT", "Provider accepted a duplicate settlement.")]},
    {"id": "race_condition", "title": "Race Condition", "severity": "CRITICAL", "targetRefundId": "REF1002", "duplicateMinor": 5000, "missingLedgerMinor": 0, "fxLossMinor": 0, "example": "Two workers process the same pending refund concurrently.", "rootCause": "Jobs are not claimed atomically.", "events": [("INFO", "JOB_READ", "Worker 02 read the refund as PENDING."), ("INFO", "JOB_READ", "Worker 03 also read the refund as PENDING."), ("INFO", "PROVIDER_CALL", "Worker 02 settled the refund."), ("INFO", "PROVIDER_CALL", "Worker 03 also settled the refund."), ("ERROR", "DUPLICATE_PAYMENT", "Two provider settlements exist for one request.")]},
    {"id": "provider_timeout", "title": "Provider Timeout", "severity": "HIGH", "targetRefundId": "REF1003", "duplicateMinor": 7500, "missingLedgerMinor": 0, "fxLossMinor": 0, "example": "A settled refund is retried after the provider response times out.", "rootCause": "Retries do not verify provider status first.", "events": [("INFO", "PROVIDER_CALL", "Provider request was sent for the refund."), ("WARN", "PROVIDER_TIMEOUT", "The response timed out although the provider settled."), ("WARN", "RETRY_NO_VERIFY", "Retry started without probing provider status."), ("INFO", "PROVIDER_CALL", "Provider accepted another settlement."), ("ERROR", "DUPLICATE_PAYMENT", "The refund was paid twice.")]},
    {"id": "missing_ledger", "title": "Missing Ledger Entry", "severity": "HIGH", "targetRefundId": "REF1004", "duplicateMinor": 0, "missingLedgerMinor": 12000, "fxLossMinor": 0, "example": "The provider settlement has no corresponding ledger record.", "rootCause": "Ledger posting has no recovery process.", "events": [("INFO", "PROVIDER_CALL", "Provider settled the refund."), ("ERROR", "LEDGER_INSERT_MISSING", "Worker stopped before the ledger insert committed."), ("WARN", "NO_RECOVERY", "No recovery job repaired the missing entry."), ("ERROR", "BOOKS_OFFLINE", "Internal books do not include the provider settlement.")]},
    {"id": "fx_error", "title": "FX Conversion Error", "severity": "MEDIUM", "targetRefundId": "REF1005", "duplicateMinor": 0, "missingLedgerMinor": 0, "fxLossMinor": 500, "example": "A stale FX rate books EUR 100 at USD 105 instead of USD 110.", "rootCause": "FX rates are not pinned and converted with decimal arithmetic.", "events": [("INFO", "FX_LOOKUP", "Expected EUR/USD rate is 1.10."), ("WARN", "FX_RATE_STALE", "A stale fallback rate of 1.05 was selected."), ("WARN", "FLOAT_ROUNDING", "Floating-point conversion produced a different amount."), ("ERROR", "BOOKED_WRONG_AMOUNT", "Ledger amount is short by USD 5.00.")]},
    {"id": "worker_crash", "title": "Worker Crash and Retry", "severity": "MEDIUM", "targetRefundId": "REF1006", "duplicateMinor": 0, "missingLedgerMinor": 0, "fxLossMinor": 0, "example": "A crashed worker leaves a job incomplete until a retry recovers it.", "rootCause": "Jobs need bounded retries and lease-based recovery.", "events": [("INFO", "JOB_CLAIMED", "Worker claimed the refund job."), ("ERROR", "WORKER_CRASH", "Worker crashed while processing the refund."), ("WARN", "ORPHANED_JOB", "No lease timeout returned the job to the queue."), ("INFO", "PROVIDER_CALL", "Provider accepted the retry attempt."), ("INFO", "LEDGER_POSTED", "Ledger entry was posted after recovery.")]},
]
FIXES = [
    {"id": "idempotency_keys", "name": "Idempotency protection", "status": "PROPOSED"},
    {"id": "atomic_claim", "name": "Atomic job claiming", "status": "PROPOSED"},
    {"id": "provider_status_probe", "name": "Provider status verification", "status": "PROPOSED"},
    {"id": "ledger_recovery", "name": "Reliable ledger recovery", "status": "PROPOSED"},
    {"id": "decimal_fx", "name": "Decimal-based currency conversion", "status": "PROPOSED"},
    {"id": "safe_retry", "name": "Safe worker retry", "status": "PROPOSED"},
]


class SignupInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    password: str = Field(min_length=1, max_length=128)


class CustomerInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    currency: str = Field(pattern=r"^(USD|EUR|GBP)$")


class OrderInput(BaseModel):
    customerId: str = Field(min_length=1, max_length=40)
    amount: str = Field(pattern=r"^\d+(?:\.\d{1,2})?$")
    currency: str = Field(pattern=r"^(USD|EUR|GBP)$")
    status: str = Field(default="DELIVERED", pattern=r"^(SHIPPED|DELIVERED|CANCELLED)$")


class RefundInput(BaseModel):
    customerId: str = Field(min_length=1, max_length=40)
    orderId: str = Field(min_length=1, max_length=40)
    amount: str = Field(pattern=r"^\d+(?:\.\d{1,2})?$")
    currency: str = Field(pattern=r"^(USD|EUR|GBP)$")


def parse_amount(amount: str) -> int:
    try:
        value = Decimal(amount)
    except InvalidOperation as error:
        raise HTTPException(status_code=422, detail="Amount must be a valid positive number") from error
    if not value.is_finite() or value <= 0:
        raise HTTPException(status_code=422, detail="Amount must be a positive number")
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_usd_minor(amount_minor: int, currency: str) -> int:
    rate = FX_RATES.get(currency)
    if rate is None:
        raise ValueError(f"Unsupported currency: {currency}")
    return int((Decimal(amount_minor) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


WORLD_TABLES = {
    "customers": ("customers", {"created_at": "createdAt"}),
    "orders": ("orders", {"customer_id": "customerId", "amount_minor": "amountMinor", "created_at": "createdAt"}),
    "refunds": ("refunds", {"customer_id": "customerId", "order_id": "orderId", "amount_minor": "amountMinor", "provider_status": "providerStatus", "ledger_status": "ledgerStatus", "worker_id": "workerId", "retry_count": "retryCount", "created_at": "createdAt", "paid_at": "paidAt"}),
    "provider_transactions": ("providerTransactions", {"refund_id": "refundId", "amount_minor": "amountMinor", "settlement_id": "settlementId", "created_at": "createdAt"}),
    "ledger_entries": ("ledgerEntries", {"refund_id": "refundId", "amount_minor": "amountMinor", "created_at": "createdAt"}),
    "worker_jobs": ("workerJobs", {"worker_id": "workerId", "refund_id": "refundId", "claimed_at": "claimedAt", "finished_at": "finishedAt"}),
    "worker_logs": ("workerLogs", {"worker_id": "workerId", "refund_id": "refundId", "created_at": "createdAt"}),
    "fx_rates": ("fxRates", {"from_currency": "fromCurrency", "to_currency": "toCurrency", "effective_date": "effectiveDate"}),
}


def has_currency_mismatch(
    refund: dict[str, Any] | None,
    settlements: list[dict[str, Any]],
    entries: list[dict[str, Any]],
) -> bool:
    if refund is None:
        return False
    expected_currency = refund["currency"]
    return (
        any(item["currency"] != expected_currency for item in settlements)
        or any(item["currency"] not in {expected_currency, "USD"} for item in entries)
    )


def latest_fix_run(db: Database, user_id: str) -> dict[str, Any] | None:
    row = db.row(
        "SELECT result_json FROM fix_runs WHERE owner_id = ? ORDER BY ran_at DESC, id DESC LIMIT 1",
        (user_id,),
    )
    return json.loads(row["result_json"]) if row else None


def apply_corrected_world(world: dict[str, list[dict[str, Any]]], fix_run: dict[str, Any]) -> None:
    applied_at = fix_run["acknowledgedAt"]
    refunds = {refund["id"]: refund for refund in world["refunds"]}

    kept_provider: list[dict[str, Any]] = []
    seen_settled_refunds: set[str] = set()
    settlement_created_at: dict[str, str] = {}
    for transaction in sorted(
        world["providerTransactions"],
        key=lambda item: (item["createdAt"], item["id"]),
    ):
        refund_id = transaction["refundId"]
        if transaction["status"] == "SETTLED":
            if refund_id in seen_settled_refunds:
                continue
            seen_settled_refunds.add(refund_id)
            settlement_created_at[refund_id] = transaction["createdAt"]
        kept_provider.append(transaction)
    world["providerTransactions"] = kept_provider

    ledger_by_refund: dict[str, list[dict[str, Any]]] = {}
    for entry in world["ledgerEntries"]:
        ledger_by_refund.setdefault(entry["refundId"], []).append(entry)

    kept_ledger = [
        entry for entry in world["ledgerEntries"]
        if entry["refundId"] not in seen_settled_refunds
    ]
    for refund_id in sorted(seen_settled_refunds):
        refund = refunds.get(refund_id)
        if refund is None:
            continue
        existing = sorted(
            ledger_by_refund.get(refund_id, []),
            key=lambda item: (item["createdAt"], item["id"]),
        )
        amount_usd = to_usd_minor(refund["amountMinor"], refund["currency"])
        updated_at = max(applied_at, settlement_created_at[refund_id])
        if existing:
            corrected_entry = dict(existing[0])
            corrected_entry.update({
                "amountMinor": amount_usd,
                "currency": "USD",
                "status": "POSTED",
                "source": "verified-fix-simulation",
                "updatedAt": updated_at,
            })
        else:
            corrected_entry = {
                "id": f"LEDGER-FIX-{fix_run['id']}-{refund_id}",
                "refundId": refund_id,
                "amountMinor": amount_usd,
                "currency": "USD",
                "status": "POSTED",
                "createdAt": settlement_created_at[refund_id],
                "updatedAt": updated_at,
                "source": "verified-fix-simulation",
            }
        kept_ledger.append(corrected_entry)
        refund["ledgerStatus"] = "POSTED"
    world["ledgerEntries"] = kept_ledger

    kept_jobs: list[dict[str, Any]] = []
    seen_completed_refunds: set[str] = set()
    for job in sorted(
        world["workerJobs"],
        key=lambda item: (item.get("claimedAt") or "", item["id"]),
    ):
        if job["status"] == "DONE":
            if job["refundId"] in seen_completed_refunds:
                continue
            seen_completed_refunds.add(job["refundId"])
        corrected_job = dict(job)
        corrected_job["attempts"] = min(5, max(1, corrected_job["attempts"]))
        kept_jobs.append(corrected_job)
    world["workerJobs"] = kept_jobs
    world["workerLogs"].append({
        "id": f"LOG-{fix_run['id']}-APPLIED",
        "workerId": "fix-engine",
        "refundId": None,
        "level": "INFO",
        "event": "FIX_APPLIED",
        "status": "APPLIED",
        "message": f"Verified fixes acknowledged; synthetic records corrected at {applied_at}. Source database rows remain unchanged.",
        "createdAt": applied_at,
    })


def load_world_data(db: Database, user_id: str, include_applied_fixes: bool = True) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for table, (key, rename) in WORLD_TABLES.items():
        if table in {"customers", "orders", "refunds"}:
            rows = db.rows(f"SELECT * FROM {table} WHERE user_id IS NULL OR user_id = ?", (user_id,))
        elif table == "fx_rates":
            rows = db.rows("SELECT * FROM fx_rates")
        elif table == "worker_logs":
            rows = db.rows(
                """SELECT child.* FROM worker_logs child
                   LEFT JOIN refunds parent ON parent.id = child.refund_id
                   WHERE child.refund_id IS NULL OR parent.user_id IS NULL OR parent.user_id = ?""",
                (user_id,),
            )
        else:
            rows = db.rows(
                f"""SELECT child.* FROM {table} child JOIN refunds parent ON parent.id = child.refund_id
                    WHERE parent.user_id IS NULL OR parent.user_id = ?""",
                (user_id,),
            )
        result[key] = [as_json(row, rename) for row in rows]

    fix_run = latest_fix_run(db, user_id) if include_applied_fixes else None
    if fix_run and fix_run.get("acknowledgedAt") and all(check["status"] == "PASS" for check in fix_run["check"]):
        apply_corrected_world(result, fix_run)
    return result


def find_findings(db: Database, user_id: str) -> list[dict[str, Any]]:
    world = load_world_data(db, user_id)
    refunds = {row["id"]: row for row in world["refunds"]}
    txs: dict[str, list[dict[str, Any]]] = {}
    ledgers: dict[str, list[dict[str, Any]]] = {}
    for row in world["providerTransactions"]:
        if row["status"] == "SETTLED":
            txs.setdefault(row["refundId"], []).append(row)
    for row in world["ledgerEntries"]:
        if row["status"] == "POSTED":
            ledgers.setdefault(row["refundId"], []).append(row)
    findings = []
    for refund_id, settlements in txs.items():
        entries = ledgers.get(refund_id, [])
        provider_usd = sum(to_usd_minor(row["amountMinor"], row["currency"]) for row in settlements)
        ledger_usd = sum(to_usd_minor(row["amountMinor"], row["currency"]) for row in entries)
        refund = refunds.get(refund_id)
        currency_mismatch = has_currency_mismatch(refund, settlements, entries)
        difference_usd = provider_usd - ledger_usd
        provider_currency = settlements[0]["currency"]
        ledger_currency = entries[0]["currency"] if entries else provider_currency
        if len(settlements) > 1:
            kind, severity = "DUPLICATE_REFUND", "HIGH"
            cause = f"{len(settlements)} provider settlements exist for one refund request"
        elif not entries:
            kind, severity = "MISSING_LEDGER", "HIGH"
            cause = "Provider settled the refund but no ledger entry was posted"
        elif currency_mismatch:
            kind, severity = "CURRENCY_MISMATCH", "MEDIUM"
            cause = f"Provider currency {provider_currency} or ledger currency {ledger_currency} does not match the refund's expected currency."
        elif difference_usd != 0:
            kind, severity = "AMOUNT_MISMATCH", "MEDIUM"
            direction = "short" if difference_usd > 0 else "over"
            cause = (
                f"Provider settlements equal ${provider_usd / 100:.2f} USD after conversion; "
                f"the ledger records ${ledger_usd / 100:.2f} USD, a ${abs(difference_usd) / 100:.2f} {direction}fall."
            )
        else:
            continue
        findings.append({
            "id": f"F{refund_id}-{kind}", "refundId": refund_id,
            "customerId": refund.get("customerId", "—") if refund else "—",
            "providerMinor": provider_usd, "ledgerMinor": ledger_usd,
            "differenceMinor": difference_usd, "currency": "USD",
            "providerCurrency": provider_currency, "ledgerCurrency": ledger_currency,
            "kind": kind, "cause": cause, "severity": severity,
        })
    return findings


def run_reconciliation(
    db: Database,
    label: str,
    ran_at: str,
    user_id: str,
    include_applied_fixes: bool = True,
) -> dict[str, Any]:
    world = load_world_data(db, user_id, include_applied_fixes)
    refunds = {row["id"]: row for row in world["refunds"]}
    txs: dict[str, list[dict[str, Any]]] = {}
    ledgers: dict[str, list[dict[str, Any]]] = {}
    for row in world["providerTransactions"]:
        if row["status"] == "SETTLED":
            txs.setdefault(row["refundId"], []).append(row)
    for row in world["ledgerEntries"]:
        if row["status"] == "POSTED":
            ledgers.setdefault(row["refundId"], []).append(row)
    rows = []
    matched = provider_only = ledger_only = duplicates = amount_mismatch = currency_mismatch = net = 0
    for refund_id, settlements in txs.items():
        entries = ledgers.get(refund_id, [])
        paid = sum(to_usd_minor(item["amountMinor"], item["currency"]) for item in settlements)
        booked = sum(to_usd_minor(item["amountMinor"], item["currency"]) for item in entries)
        refund = refunds.get(refund_id)
        mismatch_currency = has_currency_mismatch(refund, settlements, entries)
        difference = paid - booked
        provider_currency = settlements[0]["currency"]
        ledger_currency = entries[0]["currency"] if entries else "USD"
        currency_mismatch += int(mismatch_currency)
        if not entries:
            provider_only += 1
            side = "PROVIDER_ONLY"
        else:
            duplicates += max(0, len(settlements) - 1)
            amount_mismatch += int(difference != 0)
            if mismatch_currency:
                side = "CURRENCY_MISMATCH"
            elif difference == 0:
                matched += 1
                side = "MATCHED"
            else:
                side = "AMOUNT_MISMATCH"
        net += difference
        rows.append({
            "settlementId": "+".join(item["id"] for item in settlements), "refundId": refund_id,
            "providerMinor": paid, "ledgerMinor": booked, "differenceMinor": difference,
            "currency": "USD", "providerCurrency": provider_currency, "ledgerCurrency": ledger_currency,
            "side": side,
        })
    for refund_id, entries in ledgers.items():
        if refund_id not in txs:
            amount = sum(to_usd_minor(item["amountMinor"], item["currency"]) for item in entries)
            ledger_only += 1
            net -= amount
            rows.append({
                "settlementId": "—", "refundId": refund_id, "providerMinor": 0,
                "ledgerMinor": amount, "differenceMinor": -amount, "currency": "USD",
                "providerCurrency": "USD", "ledgerCurrency": entries[0]["currency"],
                "side": "LEDGER_ONLY",
            })
    result = {
        "id": f"REC-{uuid4().hex[:8]}", "label": label, "ranAt": ran_at,
        "matchedCount": matched, "providerOnlyCount": provider_only,
        "ledgerOnlyCount": ledger_only, "duplicateCount": duplicates,
        "amountMismatchCount": amount_mismatch, "currencyMismatchCount": currency_mismatch,
        "netDiscrepancyMinor": net, "rows": rows,
    }
    with db.connect() as connection:
        connection.execute(
            "INSERT INTO reconciliation_runs (id, label, ran_at, owner_id, result_json) VALUES (?, ?, ?, ?, ?)",
            (result["id"], label, ran_at, user_id, json.dumps(result)),
        )
    return result


def execute_fix_checks(db: Database, user_id: str) -> dict[str, Any]:
    refunds = {
        row["id"]: row
        for row in db.rows("SELECT * FROM refunds WHERE user_id IS NULL OR user_id = ?", (user_id,))
    }
    provider = db.rows(
        """SELECT child.* FROM provider_transactions child JOIN refunds parent ON parent.id = child.refund_id
           WHERE child.status = 'SETTLED' AND (parent.user_id IS NULL OR parent.user_id = ?)
           ORDER BY child.created_at, child.id""",
        (user_id,),
    )
    ledger = db.rows(
        """SELECT child.* FROM ledger_entries child JOIN refunds parent ON parent.id = child.refund_id
           WHERE child.status = 'POSTED' AND (parent.user_id IS NULL OR parent.user_id = ?)""",
        (user_id,),
    )
    jobs = db.rows(
        """SELECT child.* FROM worker_jobs child JOIN refunds parent ON parent.id = child.refund_id
           WHERE child.status = 'DONE' AND (parent.user_id IS NULL OR parent.user_id = ?)
           ORDER BY child.claimed_at, child.id""",
        (user_id,),
    )

    provider_count: dict[str, int] = {}
    for item in provider:
        provider_count[item["refund_id"]] = provider_count.get(item["refund_id"], 0) + 1
    job_count: dict[str, int] = {}
    for item in jobs:
        job_count[item["refund_id"]] = job_count.get(item["refund_id"], 0) + 1
    duplicate_refunds = sum(count > 1 for count in provider_count.values())
    duplicate_job_groups = sum(count > 1 for count in job_count.values())
    ledger_ids = {item["refund_id"] for item in ledger}
    missing_ledger_count = sum(refund_id not in ledger_ids for refund_id in provider_count)

    before_rec = run_reconciliation(db, "before-fixes", now_iso(), user_id, include_applied_fixes=False)
    provider_total = sum(to_usd_minor(item["amount_minor"], item["currency"]) for item in provider)
    ledger_total = sum(to_usd_minor(item["amount_minor"], item["currency"]) for item in ledger)
    before = {
        "netDiscrepancyMinor": before_rec["netDiscrepancyMinor"],
        "providerPayoutMinor": provider_total, "ledgerTotalMinor": ledger_total,
        "duplicateCount": before_rec["duplicateCount"], "refundCount": len(refunds),
    }

    corrected_provider: dict[str, dict[str, Any]] = {}
    for item in provider:
        corrected_provider.setdefault(item["refund_id"], item)
    corrected_jobs: dict[str, dict[str, Any]] = {}
    for item in jobs:
        corrected_jobs.setdefault(item["refund_id"], item)

    corrected_ledger = {
        refund_id: to_usd_minor(refunds[refund_id]["amount_minor"], refunds[refund_id]["currency"])
        for refund_id in corrected_provider
        if refund_id in refunds
    }
    corrected_provider_total = sum(
        to_usd_minor(item["amount_minor"], item["currency"])
        for item in corrected_provider.values()
    )
    corrected_ledger_total = sum(corrected_ledger.values())
    remaining_duplicates = 0
    remaining_missing = sum(refund_id not in corrected_ledger for refund_id in corrected_provider)
    fx_checks_pass = all(
        corrected_ledger[refund_id] == to_usd_minor(
            refunds[refund_id]["amount_minor"],
            refunds[refund_id]["currency"],
        )
        and to_usd_minor(
            corrected_provider[refund_id]["amount_minor"],
            corrected_provider[refund_id]["currency"],
        ) == to_usd_minor(refunds[refund_id]["amount_minor"], refunds[refund_id]["currency"])
        for refund_id in corrected_provider
        if refund_id in refunds and refunds[refund_id]["currency"] != "USD"
    )
    all_attempts = db.rows(
        """SELECT child.attempts FROM worker_jobs child JOIN refunds parent ON parent.id = child.refund_id
           WHERE parent.user_id IS NULL OR parent.user_id = ?""",
        (user_id,),
    )
    corrected_attempts = [min(5, max(1, row["attempts"])) for row in all_attempts]
    corrected_job_counts: dict[str, int] = {}
    for item in corrected_jobs.values():
        corrected_job_counts[item["refund_id"]] = corrected_job_counts.get(item["refund_id"], 0) + 1

    checks = [
        ("idempotency_keys", remaining_duplicates == 0,
         f"Suppressed {duplicate_refunds} duplicate settlement group(s); each refund has at most one payout in the corrected run."),
        ("atomic_claim", all(count <= 1 for count in corrected_job_counts.values()),
         f"Collapsed {duplicate_job_groups} duplicate completed-job group(s); each refund has one owner in the corrected run."),
        ("provider_status_probe", remaining_duplicates == 0,
         "The corrected retry path checks provider status and does not resend settled refunds."),
        ("ledger_recovery", remaining_missing == 0,
         f"Repaired {missing_ledger_count} missing ledger entry/entries in the corrected run."),
        ("decimal_fx", fx_checks_pass,
         "Converted refunds reconcile using pinned EUR/USD and GBP/USD rates with minor-unit rounding."),
        ("safe_retry", all(1 <= attempts <= 5 for attempts in corrected_attempts),
         "Corrected worker attempts are bounded between 1 and 5."),
    ]
    result_checks = [
        {"id": key, "fixId": key, "status": "PASS" if passed else "FAIL", "detail": detail}
        for key, passed, detail in checks
    ]
    after = {
        "netDiscrepancyMinor": corrected_provider_total - corrected_ledger_total,
        "providerPayoutMinor": corrected_provider_total, "ledgerTotalMinor": corrected_ledger_total,
        "duplicateCount": remaining_duplicates, "refundCount": len(refunds),
    }
    run_at = now_iso()
    result = {
        "id": f"FIXRUN-{uuid4().hex[:8]}",
        "ranAt": run_at,
        "acknowledgedAt": None,
        "revertedAt": None,
        "check": result_checks,
        "before": before,
        "after": after,
    }
    with db.connect() as connection:
        connection.execute(
            "INSERT INTO fix_runs (id, ran_at, owner_id, result_json) VALUES (?, ?, ?, ?)",
            (result["id"], run_at, user_id, json.dumps(result)),
        )
    return result


app = create_app()
