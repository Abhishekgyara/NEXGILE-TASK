import os
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.pool import StaticPool


DEFAULT_URL = "mysql+pymysql://root@127.0.0.1:3306/refundguard"


class Row(dict):
    def __init__(self, keys: list[str], values: tuple[Any, ...]):
        super().__init__(zip(keys, values))
        self._values = values

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)


class Result:
    def __init__(self, result: Any):
        self.keys = list(result.keys()) if result.returns_rows else []
        self._result = result

    def fetchone(self) -> Row | None:
        row = self._result.fetchone()
        return Row(self.keys, tuple(row)) if row is not None else None

    def fetchall(self) -> list[Row]:
        return [Row(self.keys, tuple(row)) for row in self._result.fetchall()]

    @property
    def rowcount(self) -> int:
        return self._result.rowcount


class CompatConnection:
    def __init__(self, connection: Connection, dialect: str):
        self.connection = connection
        self.dialect = dialect

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> Result:
        statement = query.strip()
        if statement.upper() == "BEGIN IMMEDIATE":
            return Result(self.connection.exec_driver_sql("SELECT 1"))
        statement = re.sub(r"^INSERT\s+OR\s+REPLACE\s+INTO", "REPLACE INTO", statement, flags=re.IGNORECASE)
        if self.dialect == "mysql":
            statement = re.sub(r"\?", "%s", statement)
        return Result(self.connection.exec_driver_sql(statement, params))

    def executemany(self, query: str, params: list[tuple[Any, ...]]) -> Result:
        statement = re.sub(r"\?", "%s", query) if self.dialect == "mysql" else query
        return Result(self.connection.exec_driver_sql(statement, params))

    def executescript(self, script: str) -> None:
        for statement in script.split(";"):
            statement = statement.strip()
            if not statement:
                continue
            if self.dialect == "mysql":
                statement = re.sub(r"\bTEXT\b", "VARCHAR(255)", statement, flags=re.IGNORECASE)
                statement = re.sub(
                    r"\bresult_json\s+VARCHAR\(255\)",
                    "result_json LONGTEXT",
                    statement,
                    flags=re.IGNORECASE,
                )
                if statement.upper().startswith(("CREATE INDEX IF NOT EXISTS", "CREATE UNIQUE INDEX IF NOT EXISTS")):
                    statement = re.sub(
                        r"^CREATE (UNIQUE )?INDEX IF NOT EXISTS",
                        lambda match: f"CREATE {match.group(1) or ''}INDEX",
                        statement,
                        flags=re.IGNORECASE,
                    )
                    try:
                        self.connection.exec_driver_sql(statement)
                    except Exception as error:
                        if "Duplicate key name" not in str(error) and "already exists" not in str(error):
                            raise
                    continue
            self.connection.exec_driver_sql(statement)


class Database:
    def __init__(self, path: str | Path | None = None):
        self.path = str(path) if path is not None else None
        if path is not None:
            url = "sqlite:///:memory:" if self.path == ":memory:" else f"sqlite:///{Path(self.path).resolve().as_posix()}"
            options: dict[str, Any] = {"future": True}
            if self.path == ":memory:":
                options["poolclass"] = StaticPool
        else:
            url = os.getenv("DATABASE_URL", DEFAULT_URL)
            options = {"pool_pre_ping": True, "future": True}
            if url.startswith("sqlite") and (":memory:" in url or url.rstrip("/") == "sqlite:"):
                options["poolclass"] = StaticPool
        self.engine: Engine = create_engine(url, **options)
        self.dialect = self.engine.dialect.name
        if self.dialect not in {"sqlite", "mysql"}:
            raise RuntimeError(f"Unsupported database dialect: {self.dialect}")
        self.initialize()

    @contextmanager
    def connect(self) -> Iterator[CompatConnection]:
        connection = self.engine.connect()
        try:
            yield CompatConnection(connection, self.dialect)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
                    currency TEXT NOT NULL CHECK(currency IN ('USD', 'EUR', 'GBP')),
                    created_at TEXT NOT NULL, user_id TEXT REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
                    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
                    currency TEXT NOT NULL CHECK(currency IN ('USD', 'EUR', 'GBP')),
                    status TEXT NOT NULL, created_at TEXT NOT NULL, user_id TEXT REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS refunds (
                    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
                    order_id TEXT NOT NULL REFERENCES orders(id), amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
                    currency TEXT NOT NULL CHECK(currency IN ('USD', 'EUR', 'GBP')),
                    status TEXT NOT NULL, provider_status TEXT NOT NULL, ledger_status TEXT NOT NULL,
                    worker_id TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, paid_at TEXT, scenario TEXT, user_id TEXT REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS provider_transactions (
                    id TEXT PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES refunds(id),
                    amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
                    settlement_id TEXT NOT NULL, created_at TEXT NOT NULL, source TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ledger_entries (
                    id TEXT PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES refunds(id),
                    amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
                    created_at TEXT NOT NULL, source TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS worker_jobs (
                    id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, refund_id TEXT NOT NULL REFERENCES refunds(id),
                    status TEXT NOT NULL, attempts INTEGER NOT NULL, claimed_at TEXT, finished_at TEXT
                );
                CREATE TABLE IF NOT EXISTS worker_logs (
                    id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, refund_id TEXT REFERENCES refunds(id),
                    level TEXT NOT NULL, event TEXT NOT NULL, status TEXT NOT NULL,
                    message TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS fx_rates (
                    from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate REAL NOT NULL,
                    effective_date TEXT NOT NULL, source TEXT NOT NULL,
                    PRIMARY KEY (from_currency, to_currency, effective_date)
                );
                CREATE TABLE IF NOT EXISTS reconciliation_runs (
                    id TEXT PRIMARY KEY, label TEXT NOT NULL, ran_at TEXT NOT NULL,
                    owner_id TEXT NOT NULL REFERENCES users(id), result_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS simulation_runs (
                    scenario_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
                    result_json TEXT NOT NULL, PRIMARY KEY (scenario_id, owner_id)
                );
                CREATE TABLE IF NOT EXISTS fix_runs (
                    id TEXT PRIMARY KEY, ran_at TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
                    result_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_refunds_customer ON refunds(customer_id);
                CREATE INDEX IF NOT EXISTS idx_refunds_created ON refunds(created_at);
                CREATE INDEX IF NOT EXISTS idx_provider_refund ON provider_transactions(refund_id);
                CREATE INDEX IF NOT EXISTS idx_ledger_refund ON ledger_entries(refund_id);
                CREATE INDEX IF NOT EXISTS idx_logs_created ON worker_logs(created_at);
                CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_owner_email ON customers(user_id, email);
                """
            )
            if connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 0:
                self._seed(connection)

    @staticmethod
    def _seed(connection: CompatConnection) -> None:
        customers = [
            ("C101", "Ava Berg", "customer101@mail.example", "USD"),
            ("C205", "Noah Lund", "customer205@mail.example", "USD"),
            ("C310", "Mia Voss", "customer310@mail.example", "USD"),
            ("C415", "Liam Dahl", "customer415@mail.example", "EUR"),
            ("C512", "Zoe Klein", "customer512@mail.example", "USD"),
            ("C600", "Ethan Roos", "customer600@mail.example", "GBP"),
        ]
        created = "2026-11-23T14:00:00Z"
        connection.executemany(
            "INSERT INTO customers (id, name, email, currency, created_at, user_id) VALUES (?, ?, ?, ?, ?, NULL)",
            [(*customer, created) for customer in customers],
        )
        orders = [
            ("ORD1001", "C101", 20000, "USD", "DELIVERED"),
            ("ORD1002", "C101", 10000, "USD", "DELIVERED"),
            ("ORD1003", "C205", 15000, "USD", "DELIVERED"),
            ("ORD1004", "C310", 24000, "USD", "DELIVERED"),
            ("ORD1005", "C415", 20000, "EUR", "DELIVERED"),
            ("ORD1006", "C512", 12800, "USD", "SHIPPED"),
            ("ORD1007", "C600", 18000, "GBP", "DELIVERED"),
        ]
        connection.executemany(
            "INSERT INTO orders (id, customer_id, amount_minor, currency, status, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, NULL)",
            [(*order, created) for order in orders],
        )
        refunds = [
            ("REF1001", "C101", "ORD1001", 10000, "USD", "PAID", "SETTLED", "POSTED", "worker-01", 1, created, created, "duplicate_refund"),
            ("REF1002", "C101", "ORD1002", 5000, "USD", "PAID", "SETTLED", "POSTED", "worker-02", 0, created, created, "race_condition"),
            ("REF1003", "C205", "ORD1003", 7500, "USD", "PAID", "SETTLED", "POSTED", "worker-03", 1, created, created, "provider_timeout"),
            ("REF1004", "C310", "ORD1004", 12000, "USD", "PAID", "SETTLED", "NOT_RECORDED", "worker-04", 0, created, created, "missing_ledger"),
            ("REF1005", "C415", "ORD1005", 10000, "EUR", "PAID", "SETTLED", "POSTED", "worker-01", 0, created, created, "fx_error"),
            ("REF1006", "C512", "ORD1006", 6400, "USD", "PAID", "SETTLED", "POSTED", "worker-02", 2, created, created, "worker_crash"),
            ("REF1007", "C600", "ORD1007", 4500, "GBP", "PENDING", "NOT_SENT", "NOT_RECORDED", None, 0, created, None, None),
        ]
        connection.executemany(
            """INSERT INTO refunds
            (id, customer_id, order_id, amount_minor, currency, status, provider_status, ledger_status,
             worker_id, retry_count, created_at, paid_at, scenario, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
            refunds,
        )
        transactions = [
            ("TX1001A", "REF1001", 10000, "USD", "SETTLED", "STL1001A", created, "seed:duplicate_refund"),
            ("TX1001B", "REF1001", 10000, "USD", "SETTLED", "STL1001B", created, "seed:retry_duplicate"),
            ("TX1002A", "REF1002", 5000, "USD", "SETTLED", "STL1002A", created, "seed:race_condition"),
            ("TX1002B", "REF1002", 5000, "USD", "SETTLED", "STL1002B", created, "seed:race_condition"),
            ("TX1003A", "REF1003", 7500, "USD", "SETTLED", "STL1003A", created, "seed:provider_timeout"),
            ("TX1003B", "REF1003", 7500, "USD", "SETTLED", "STL1003B", created, "seed:timeout_retry"),
            ("TX1004", "REF1004", 12000, "USD", "SETTLED", "STL1004", created, "seed:missing_ledger"),
            ("TX1005", "REF1005", 10000, "EUR", "SETTLED", "STL1005", created, "seed:fx_error"),
            ("TX1006", "REF1006", 6400, "USD", "SETTLED", "STL1006", created, "seed:worker_crash"),
        ]
        connection.executemany(
            "INSERT INTO provider_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", transactions
        )
        entries = [
            ("LE1001", "REF1001", 10000, "USD", "POSTED", created, "seed:duplicate_refund"),
            ("LE1002", "REF1002", 5000, "USD", "POSTED", created, "seed:race_condition"),
            ("LE1003", "REF1003", 7500, "USD", "POSTED", created, "seed:provider_timeout"),
            ("LE1005", "REF1005", 10500, "USD", "POSTED", created, "seed:stale_fx"),
            ("LE1006", "REF1006", 6400, "USD", "POSTED", created, "seed:worker_crash"),
        ]
        connection.executemany(
            "INSERT INTO ledger_entries VALUES (?, ?, ?, ?, ?, ?, ?)", entries
        )
        jobs = [
            ("JOB1001", "worker-01", "REF1001", "DONE", 2, created, created),
            ("JOB1002", "worker-02", "REF1002", "DONE", 1, created, created),
            ("JOB1003", "worker-03", "REF1003", "DONE", 2, created, created),
            ("JOB1004", "worker-04", "REF1004", "DONE", 1, created, created),
            ("JOB1005", "worker-01", "REF1005", "DONE", 1, created, created),
            ("JOB1006", "worker-02", "REF1006", "DONE", 3, created, created),
        ]
        connection.executemany(
            "INSERT INTO worker_jobs VALUES (?, ?, ?, ?, ?, ?, ?)", jobs
        )
        logs = [
            ("WL1001", "worker-01", "REF1001", "ERROR", "WORKER_CRASH", "ERR", "Worker crashed after provider call; retry caused a duplicate payout", created),
            ("WL1002", "worker-02", "REF1002", "ERROR", "DUPLICATE_DETECTED", "ERR", "Two worker claims created duplicate settlements", created),
            ("WL1003", "worker-03", "REF1003", "WARN", "PROVIDER_TIMEOUT", "RETRY", "Provider settled but the response timed out before retry", created),
            ("WL1004", "worker-04", "REF1004", "ERROR", "LEDGER_INSERT_MISSING", "ERR", "Provider settlement has no matching ledger entry", created),
            ("WL1005", "worker-01", "REF1005", "WARN", "FX_RATE_STALE", "ERR", "Ledger used a stale EUR exchange rate", created),
            ("WL1006", "worker-02", "REF1006", "INFO", "LEDGER_POSTED", "OK", "Ledger entry posted after worker retry", created),
        ]
        connection.executemany(
            "INSERT INTO worker_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?)", logs
        )
        connection.execute(
            "INSERT INTO fx_rates VALUES (?, 'USD', ?, ?, ?)",
            ("EUR", 1.10, created, "pinned-daily-rate"),
        )
        connection.execute(
            "INSERT INTO fx_rates VALUES (?, 'USD', ?, ?, ?)",
            ("GBP", 1.27, created, "pinned-daily-rate"),
        )

    def rows(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(query, params).fetchall()]

    def row(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.connect() as connection:
            result = connection.execute(query, params).fetchone()
            return dict(result) if result else None
