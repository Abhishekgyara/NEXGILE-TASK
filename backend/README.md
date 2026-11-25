# RefundGuard backend

FastAPI REST API backed by MySQL. The service uses synthetic data only and never
contacts a payment provider or initiates real money movement.

## MySQL setup

1. Install and start MySQL Server (the local Windows service is commonly named
   `MySQL80`). Connect as a MySQL administrator and create the database and
   application accounts (replace the example password with the same strong
   password in both places):

   ```sql
   CREATE DATABASE refundguard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'refundguard_user'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
   ALTER USER 'refundguard_user'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON refundguard.* TO 'refundguard_user'@'localhost';
   CREATE USER IF NOT EXISTS 'refundguard_user'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
   ALTER USER 'refundguard_user'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON refundguard.* TO 'refundguard_user'@'127.0.0.1';
   ```

2. Set a connection URL in PowerShell. Replace `YOUR_PASSWORD` with the actual
   password you set above; do not run the example literally:

   ```powershell
   $env:DATABASE_URL = "mysql+pymysql://refundguard_user:YOUR_PASSWORD@localhost:3306/refundguard"
   ```

   Do not commit credentials or paste them into source files. For passwords
   containing URL-reserved characters (such as `@`, `:`, `/`, or `#`),
   URL-encode those characters. In PowerShell, use single quotes around the
   URL if the password contains `$`.

3. From the `project` folder, install and start the backend:

   ```powershell
   python -m venv backend\.venv
   backend\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   uvicorn backend.main:app --reload
   ```

On first startup, tables are created and the shared synthetic demo records are
seeded if the customer table is empty. Creating accounts does not erase demo
records. To keep the URL in an untracked `backend\.env` file, start Uvicorn with
`uvicorn --env-file backend\.env backend.main:app --reload`.

## Accounts and data

- Sign-up and login use account passwords hashed with PBKDF2; sessions are
  stored server-side and sent as HTTP-only cookies.
- Each account sees the shared, read-only seeded demo records and its own
  customers, orders, refunds, and analysis runs. Other users' new records are
  not returned by the API.
- Reset clears only the signed-in user's simulation, reconciliation, and fix
  run history. It never deletes users, demo records, or user-created business
  records.
- `POST /api/customers` and `POST /api/orders` save account-owned records;
  refund requests can be created from shared or account-owned orders.

## Inspect records in MySQL

Use the MySQL command line:

```powershell
mysql -u refundguard_user -p -h localhost
```

Then query the database (password is prompted, not shown in shell history):

```sql
USE refundguard;
SHOW TABLES;
SELECT id, name, email, currency, user_id FROM customers ORDER BY created_at;
SELECT id, customer_id, amount_minor, currency, status, user_id FROM orders;
SELECT id, customer_id, order_id, amount_minor, currency, status, user_id FROM refunds;
SELECT id, refund_id, amount_minor, currency, status FROM provider_transactions;
SELECT id, refund_id, amount_minor, currency, status FROM ledger_entries;
SELECT id, email, created_at FROM users;
```

In MySQL Workbench, create a connection to `localhost:3306`, open the
`refundguard` schema, expand **Tables**, and use **Select Rows - Limit 1000**.
Amounts are stored as integer minor units (for example, `1234` means `12.34`).

Interactive API docs are available at `http://localhost:8000/docs`.

## Main endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Service and database health |
| POST | `/api/auth/signup` | Create account and start a session |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Revoke session and clear cookie |
| GET | `/api/auth/me` | Current signed-in account |
| GET | `/api/world` | Customers, orders, refunds, settlements, ledger, jobs, logs, FX rates |
| GET | `/api/dashboard` | Refund and financial KPI totals |
| POST | `/api/customers` | Add a customer to your account |
| POST | `/api/orders` | Add an order to your account |
| GET/POST | `/api/refunds` | List/search or create a refund |
| GET | `/api/refunds/{id}` | Refund with settlement, ledger, and log history |
| POST | `/api/refunds/{id}/process` | Atomically process a pending simulated refund |
| GET | `/api/customers` | List/search customers |
| GET | `/api/customers/{id}/orders` | Orders for a customer |
| GET | `/api/customers/recovery` | Customer-level recovery recommendations |
| GET | `/api/findings` | Duplicate, missing-ledger, and mismatch findings |
| GET | `/api/worker-logs` | Filter worker events |
| GET/POST | `/api/reconciliation` and `/api/reconciliation/run` | Latest or new reconciliation |
| GET/POST | `/api/scenarios`, `/api/simulations/{scenario}` | Scenario definitions and simulation |
| GET/POST | `/api/fixes`, `/api/fixes/run` | Fix catalog and verification run |
| POST | `/api/reset` | Clear the signed-in user's analysis history without deleting records |
| GET | `/api/settings` | Runtime and dataset configuration |

Refund amounts are submitted as decimal strings, for example
`{"customerId":"C600","orderId":"ORD1007","amount":"12.50","currency":"GBP"}`.
The API stores monetary values in integer minor units and validates order
ownership, currency, amount, and refund state.
