// Load .env for LIVE_DB-gated integration tests (DATABASE_URL / DIRECT_URL / secrets).
// Default DB-free unit suite is unaffected (it never touches the DB).
import "dotenv/config";
