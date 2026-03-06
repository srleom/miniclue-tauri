use reqwest::Client;
use serde_json::json;
use std::time::Duration;

const VALIDATION_TIMEOUT: Duration = Duration::from_secs(10);

/// Validates API keys for various LLM providers
pub struct ApiKeyValidator {
    client: Client,
}

impl ApiKeyValidator {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(VALIDATION_TIMEOUT)
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    /// Validates an API key for the given provider
    pub async fn validate(&self, provider: &str, api_key: &str) -> Result<(), String> {
        if api_key.is_empty() {
            return Err("API key cannot be empty".to_string());
        }

        match provider {
            "gemini" => self.validate_gemini(api_key).await,
            "openai" => self.validate_openai(api_key).await,
            "anthropic" => self.validate_anthropic(api_key).await,
            "xai" => self.validate_xai(api_key).await,
            "deepseek" => self.validate_deepseek(api_key).await,
            _ => Err(format!("Unsupported provider: {}", provider)),
        }
    }

    /// Validates a Gemini API key by calling the models endpoint
    async fn validate_gemini(&self, api_key: &str) -> Result<(), String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            api_key
        );

        let response = self
            .client
            .get(&url)
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to validate API key: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("Unable to read response"));

        match status.as_u16() {
            200 => {
                // Verify response contains models list
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if json.get("models").is_some() {
                        return Ok(());
                    }
                }
                Err("Invalid response format from Gemini".to_string())
            }
            401 | 403 => {
                // Try to extract error message from response
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json.get("error").and_then(|e| e.get("message")) {
                        return Err(format!("Invalid API key: {}", error));
                    }
                }
                Err("Invalid API key: unauthorized".to_string())
            }
            _ => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json.get("error").and_then(|e| e.get("message")) {
                        return Err(format!("API key validation failed: {}", error));
                    }
                }
                Err(format!("API key validation failed: HTTP {}", status))
            }
        }
    }

    /// Validates an OpenAI API key by calling the models endpoint
    async fn validate_openai(&self, api_key: &str) -> Result<(), String> {
        let url = "https://api.openai.com/v1/models";

        let response = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to validate API key: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("Unable to read response"));

        match status.as_u16() {
            200 => {
                // Verify response contains data list
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if json.get("data").is_some() {
                        return Ok(());
                    }
                }
                Err("Invalid response format from OpenAI".to_string())
            }
            401 => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("Invalid API key: {}", error));
                    }
                }
                Err("Invalid API key: unauthorized".to_string())
            }
            _ => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("API key validation failed: {}", error));
                    }
                }
                Err(format!("API key validation failed: HTTP {}", status))
            }
        }
    }

    /// Validates an Anthropic API key by making a minimal test call to the messages endpoint
    async fn validate_anthropic(&self, api_key: &str) -> Result<(), String> {
        let url = "https://api.anthropic.com/v1/messages";

        let request_body = json!({
            "model": "claude-haiku-4-5",
            "max_tokens": 1,
            "messages": [
                {"role": "user", "content": "test"}
            ]
        });

        let response = self
            .client
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to validate API key: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("Unable to read response"));

        match status.as_u16() {
            200 => Ok(()),
            401 => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("Invalid API key: {}", error));
                    }
                }
                Err("Invalid API key: unauthorized".to_string())
            }
            _ => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("API key validation failed: {}", error));
                    }
                }
                Err(format!("API key validation failed: HTTP {}", status))
            }
        }
    }

    /// Validates an xAI API key by calling the models endpoint (similar to OpenAI)
    async fn validate_xai(&self, api_key: &str) -> Result<(), String> {
        let url = "https://api.x.ai/v1/models";

        let response = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to validate API key: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("Unable to read response"));

        match status.as_u16() {
            200 => {
                // Verify response contains data list
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if json.get("data").is_some() {
                        return Ok(());
                    }
                }
                Err("Invalid response format from xAI".to_string())
            }
            401 => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("Invalid API key: {}", error));
                    }
                }
                Err("Invalid API key: unauthorized".to_string())
            }
            _ => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("API key validation failed: {}", error));
                    }
                }
                Err(format!("API key validation failed: HTTP {}", status))
            }
        }
    }

    /// Validates a custom OpenAI-compatible provider by making a minimal chat completions call
    pub async fn validate_custom(
        &self,
        base_url: &str,
        api_key: &str,
        model_id: &str,
    ) -> Result<(), String> {
        if api_key.is_empty() {
            return Err("API key cannot be empty".to_string());
        }
        if base_url.is_empty() {
            return Err("Base URL cannot be empty".to_string());
        }
        if model_id.is_empty() {
            return Err("Model ID cannot be empty".to_string());
        }

        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

        let request_body = json!({
            "model": model_id,
            "max_tokens": 1,
            "messages": [
                {"role": "user", "content": "test"}
            ]
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to reach custom provider: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("Unable to read response"));

        match status.as_u16() {
            200 => Ok(()),
            401 | 403 => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("Invalid API key: {}", error));
                    }
                }
                Err("Invalid API key: unauthorized".to_string())
            }
            _ => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("Custom provider validation failed: {}", error));
                    }
                }
                Err(format!(
                    "Custom provider validation failed: HTTP {}",
                    status
                ))
            }
        }
    }

    /// Validates a DeepSeek API key by calling the models endpoint (similar to OpenAI)
    async fn validate_deepseek(&self, api_key: &str) -> Result<(), String> {
        let url = "https://api.deepseek.com/v1/models";

        let response = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to validate API key: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("Unable to read response"));

        match status.as_u16() {
            200 => {
                // Verify response contains data list
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if json.get("data").is_some() {
                        return Ok(());
                    }
                }
                Err("Invalid response format from DeepSeek".to_string())
            }
            401 => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("Invalid API key: {}", error));
                    }
                }
                Err("Invalid API key: unauthorized".to_string())
            }
            _ => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(error) = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        return Err(format!("API key validation failed: {}", error));
                    }
                }
                Err(format!("API key validation failed: HTTP {}", status))
            }
        }
    }
}

impl Default for ApiKeyValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_empty_api_key() {
        let validator = ApiKeyValidator::new();
        let result = validator.validate("gemini", "").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "API key cannot be empty");
    }

    #[tokio::test]
    async fn test_unsupported_provider() {
        let validator = ApiKeyValidator::new();
        let result = validator.validate("unsupported", "test-key").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported provider"));
    }
}
