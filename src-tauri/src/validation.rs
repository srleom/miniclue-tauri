use crate::error::ApiError;

// Input length limits
pub const MAX_TITLE_LENGTH: usize = 200;
pub const MAX_DESCRIPTION_LENGTH: usize = 1000;
pub const MAX_MESSAGE_LENGTH: usize = 50_000;
pub const MAX_CHAT_NAME_LENGTH: usize = 100;

/// Validates a string length is within limits
pub fn validate_length(value: &str, max_length: usize, field_name: &str) -> Result<(), ApiError> {
    if value.len() > max_length {
        return Err(ApiError::invalid_input(format!(
            "{} must be at most {} characters (got {})",
            field_name,
            max_length,
            value.len()
        )));
    }
    Ok(())
}

/// Validates a string is not empty
pub fn validate_not_empty(value: &str, field_name: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::invalid_input(format!(
            "{} cannot be empty",
            field_name
        )));
    }
    Ok(())
}

/// Validates a title (not empty, within length limits)
pub fn validate_title(title: &str) -> Result<(), ApiError> {
    validate_not_empty(title, "Title")?;
    validate_length(title, MAX_TITLE_LENGTH, "Title")?;
    Ok(())
}

/// Validates a description (within length limits)
pub fn validate_description(description: &str) -> Result<(), ApiError> {
    validate_length(description, MAX_DESCRIPTION_LENGTH, "Description")?;
    Ok(())
}

/// Validates a chat message (not empty, within length limits)
pub fn validate_message(message: &str) -> Result<(), ApiError> {
    validate_not_empty(message, "Message")?;
    validate_length(message, MAX_MESSAGE_LENGTH, "Message")?;
    Ok(())
}

/// Validates a chat name (not empty, within length limits)
pub fn validate_chat_name(name: &str) -> Result<(), ApiError> {
    validate_not_empty(name, "Chat name")?;
    validate_length(name, MAX_CHAT_NAME_LENGTH, "Chat name")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_title() {
        assert!(validate_title("Valid Title").is_ok());
        assert!(validate_title("").is_err());
        assert!(validate_title("   ").is_err());
        assert!(validate_title(&"a".repeat(201)).is_err());
    }

    #[test]
    fn test_validate_message() {
        assert!(validate_message("Hello").is_ok());
        assert!(validate_message("").is_err());
        assert!(validate_message(&"a".repeat(50_001)).is_err());
    }
}
