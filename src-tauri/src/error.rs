use serde::Serialize;
use specta::Type;

/// Structured API error with error codes for frontend handling
#[derive(Debug, Clone, Serialize, Type)]
pub struct ApiError {
    /// Error code for programmatic handling (e.g., "NOT_FOUND", "INVALID_INPUT")
    pub code: String,
    /// Human-readable error message
    pub message: String,
}

impl ApiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message)
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new("INVALID_INPUT", message)
    }

    pub fn database_error(message: impl Into<String>) -> Self {
        Self::new("DATABASE_ERROR", message)
    }

    #[allow(dead_code)]
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new("UNAUTHORIZED", message)
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", message)
    }

    #[allow(dead_code)]
    pub fn api_key_error(message: impl Into<String>) -> Self {
        Self::new("API_KEY_ERROR", message)
    }

    pub fn file_error(message: impl Into<String>) -> Self {
        Self::new("FILE_ERROR", message)
    }

    #[allow(dead_code)]
    pub fn processing_error(message: impl Into<String>) -> Self {
        Self::new("PROCESSING_ERROR", message)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => Self::not_found("Resource not found"),
            sqlx::Error::Database(db_err) => {
                // Don't expose detailed database errors to frontend
                log::error!("Database error: {:?}", db_err);
                Self::database_error("A database error occurred")
            }
            _ => {
                log::error!("SQLx error: {:?}", err);
                Self::database_error("A database error occurred")
            }
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        log::error!("IO error: {:?}", err);
        Self::file_error(format!("File operation failed: {}", err))
    }
}

// Allow conversion from String for gradual migration
impl From<String> for ApiError {
    fn from(s: String) -> Self {
        Self::internal_error(s)
    }
}

impl From<&str> for ApiError {
    fn from(s: &str) -> Self {
        Self::internal_error(s)
    }
}
