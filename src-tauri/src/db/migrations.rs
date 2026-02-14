use sqlx::SqlitePool;

/// Run all pending database migrations
///
/// This function:
/// 1. Enables WAL mode for better concurrent performance
/// 2. Enables foreign key constraints
/// 3. Runs all pending migrations from the migrations/ directory
///
/// Migrations are tracked in the _sqlx_migrations table automatically.
/// On first run, this creates all tables. On subsequent runs, only new
/// migrations are applied.
pub async fn run(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    // Enable WAL mode for better concurrent performance
    sqlx::query("PRAGMA journal_mode=WAL").execute(pool).await?;

    // Enable foreign key constraints
    sqlx::query("PRAGMA foreign_keys=ON").execute(pool).await?;

    // Run all pending migrations from the migrations/ directory
    // The macro embeds migrations at compile time and tracks which ones have been applied
    sqlx::migrate!("./migrations").run(pool).await?;

    log::info!("Database migrations completed successfully");
    Ok(())
}
