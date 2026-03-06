use tauri::State;

use crate::config::CustomProvider;
use crate::db;
use crate::error::ApiError;
use crate::models::user::{
    ApiKeyResponse, CustomProviderRequest, CustomProviderResponse, ModelToggle, ModelsResponse,
    ProviderModels, RecentDocument, RecentDocumentsResponse, UserFolder,
};
use crate::services::validators::ApiKeyValidator;
use crate::state::AppState;

// Model catalog (ported from Go backend)
const PROVIDER_ORDER: &[&str] = &["openai", "gemini", "anthropic", "xai", "deepseek"];

lazy_static::lazy_static! {
    static ref MODEL_CATALOG: std::collections::HashMap<&'static str, Vec<(&'static str, &'static str)>> = {
        let mut m = std::collections::HashMap::new();
        m.insert("openai", vec![
            ("gpt-5.2", "GPT-5.2"),
            ("gpt-5.1", "GPT-5.1"),
            ("gpt-5.1-chat-latest", "GPT-5.1 chat latest"),
            ("gpt-5", "GPT-5"),
            ("gpt-5-chat-latest", "GPT-5 chat latest"),
            ("gpt-5-mini", "GPT-5 mini"),
            ("gpt-5-nano", "GPT-5 nano"),
            ("gpt-4.1", "GPT-4.1"),
            ("gpt-4.1-mini", "GPT-4.1 mini"),
            ("gpt-4.1-nano", "GPT-4.1 nano"),
            ("gpt-4o", "GPT-4o"),
            ("gpt-4o-mini", "GPT-4o mini"),
        ]);
        m.insert("gemini", vec![
            ("gemini-3-pro-preview", "Gemini 3 Pro Preview"),
            ("gemini-3-flash-preview", "Gemini 3 Flash Preview"),
            ("gemini-2.5-pro", "Gemini 2.5 Pro"),
            ("gemini-2.5-flash", "Gemini 2.5 Flash"),
            ("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite"),
        ]);
        m.insert("anthropic", vec![
            ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
            ("claude-haiku-4-5", "Claude Haiku 4.5"),
        ]);
        m.insert("xai", vec![
            ("grok-4-1-fast-reasoning", "Grok 4.1 Fast (Reasoning)"),
            ("grok-4-1-fast-non-reasoning", "Grok 4.1 Fast (Non-reasoning)"),
        ]);
        m.insert("deepseek", vec![
            ("deepseek-chat", "DeepSeek-V3.2 (Non-thinking Mode)"),
            ("deepseek-reasoner", "DeepSeek-V3.2 (Thinking Mode)"),
        ]);
        m
    };

    static ref DEFAULT_MODELS: std::collections::HashMap<&'static str, Vec<&'static str>> = {
        let mut m = std::collections::HashMap::new();
        m.insert("openai", vec!["gpt-4.1", "gpt-4.1-mini"]);
        m.insert("gemini", vec!["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3-pro-preview"]);
        m.insert("anthropic", vec!["claude-sonnet-4-5", "claude-haiku-4-5"]);
        m.insert("xai", vec!["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning"]);
        m.insert("deepseek", vec!["deepseek-chat", "deepseek-reasoner"]);
        m
    };
}

#[tauri::command]
#[specta::specta]
pub async fn get_folders_with_documents(
    state: State<'_, AppState>,
) -> Result<Vec<UserFolder>, ApiError> {
    let folders = db::folder::get_all_folders(&state.db).await?;

    let mut result = Vec::new();

    for folder in folders {
        // Fetch documents for this folder (no limit, no offset - get all)
        let documents =
            db::document::get_documents_by_folder(&state.db, &folder.id, 1000, 0).await?;

        let user_folder_documents = documents
            .into_iter()
            .map(|d| crate::models::user::UserFolderDocument {
                id: d.id,
                title: d.title,
                status: d.status,
                folder_id: d.folder_id,
            })
            .collect();

        result.push(UserFolder {
            id: folder.id,
            title: folder.title,
            description: folder.description,
            is_default: folder.is_default != 0,
            updated_at: folder.updated_at,
            documents: Some(user_folder_documents),
        });
    }

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn get_recent_documents(
    state: State<'_, AppState>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<RecentDocumentsResponse, ApiError> {
    let limit = limit.unwrap_or(10) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let documents = db::document::get_recent_documents(&state.db, limit, offset).await?;

    let total_count = db::document::count_all_documents(&state.db).await?;

    let recent_documents = documents
        .into_iter()
        .map(|d| RecentDocument {
            document_id: d.id,
            folder_id: d.folder_id,
            title: d.title,
        })
        .collect();

    Ok(RecentDocumentsResponse {
        documents: recent_documents,
        total_count,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn store_api_key(
    state: State<'_, AppState>,
    provider: String,
    api_key: String,
) -> Result<ApiKeyResponse, ApiError> {
    println!("[store_api_key] Storing API key for provider: {}", provider);

    if api_key.is_empty() {
        println!("[store_api_key] Error: API key is empty");
        return Err(ApiError::invalid_input("API key cannot be empty"));
    }

    // Check if provider already has key
    let config = state.config.read().await;
    let already_has_key = config.has_api_key(&provider);
    drop(config);

    println!(
        "[store_api_key] Provider already has key: {}",
        already_has_key
    );

    // Validate API key by making a test API call
    println!("[store_api_key] Validating API key...");
    let validator = ApiKeyValidator::new();
    validator.validate(&provider, &api_key).await.map_err(|e| {
        println!("[store_api_key] Validation failed: {}", e);
        e
    })?;
    println!("[store_api_key] API key validation successful");

    // Create backup for rollback in case of failure
    let mut config = state.config.write().await;
    let config_backup = config.backup();

    // Store API key
    println!("[store_api_key] Saving to config file...");
    config.api_keys.insert(provider.clone(), api_key);

    // Initialize default models if this is the first key for this provider
    if !already_has_key {
        if let Some(default_models) = DEFAULT_MODELS.get(provider.as_str()) {
            println!("[store_api_key] Initializing default models for new provider");
            config.init_default_models(&provider, default_models);
        }
    }

    if let Err(e) = config.save() {
        println!("[store_api_key] Error saving config: {}", e);
        // Restore backup
        config.restore(&config_backup);
        return Err(ApiError::file_error(e.to_string()));
    }
    println!("[store_api_key] Config file saved successfully");

    drop(config);
    println!("[store_api_key] Returning success response");

    Ok(ApiKeyResponse {
        provider,
        has_provided_key: true,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_api_key(
    state: State<'_, AppState>,
    provider: String,
) -> Result<ApiKeyResponse, ApiError> {
    // Remove from config file
    let mut config = state.config.write().await;
    config.api_keys.remove(&provider);
    config
        .save()
        .map_err(|e| ApiError::file_error(e.to_string()))?;
    drop(config);

    Ok(ApiKeyResponse {
        provider,
        has_provided_key: false,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_models(state: State<'_, AppState>) -> Result<ModelsResponse, ApiError> {
    let config = state.config.read().await;
    let api_keys = &config.api_keys;

    let mut providers = Vec::new();

    for &provider in PROVIDER_ORDER {
        if provider == "deepseek" {
            continue; // Disabled
        }

        let has_key = api_keys.contains_key(provider);
        if !has_key {
            continue;
        }

        if let Some(models) = MODEL_CATALOG.get(provider) {
            let toggles: Vec<ModelToggle> = models
                .iter()
                .map(|(id, name)| {
                    let enabled = config.get_model_preference(provider, id);
                    ModelToggle {
                        id: id.to_string(),
                        name: name.to_string(),
                        enabled,
                    }
                })
                .collect();

            providers.push(ProviderModels {
                provider: provider.to_string(),
                models: toggles,
            });
        }
    }

    // Append custom providers — each surfaces as a single always-active model
    for cp in &config.custom_providers {
        providers.push(ProviderModels {
            provider: format!("custom:{}", cp.id),
            models: vec![ModelToggle {
                id: cp.model_id.clone(),
                name: cp.model_id.clone(),
                enabled: true,
            }],
        });
    }

    Ok(ModelsResponse { providers })
}

#[tauri::command]
#[specta::specta]
pub async fn update_model_preference(
    state: State<'_, AppState>,
    provider: String,
    model: String,
    enabled: bool,
) -> Result<ModelToggle, ApiError> {
    if provider == "deepseek" {
        return Err(ApiError::invalid_input(
            "Provider deepseek is currently disabled",
        ));
    }

    // Validate model exists in catalog
    let catalog_models = MODEL_CATALOG
        .get(provider.as_str())
        .ok_or_else(|| ApiError::invalid_input(format!("Unsupported provider: {}", provider)))?;

    let model_name = catalog_models
        .iter()
        .find(|(id, _)| *id == model)
        .map(|(_, name)| *name)
        .ok_or_else(|| {
            ApiError::invalid_input(format!(
                "Unsupported model for provider {}: {}",
                provider, model
            ))
        })?;

    // Update config
    let mut config = state.config.write().await;
    config.set_model_preference(&provider, &model, enabled);
    config
        .save()
        .map_err(|e| ApiError::file_error(e.to_string()))?;

    Ok(ModelToggle {
        id: model,
        name: model_name.to_string(),
        enabled,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_custom_providers(
    state: State<'_, AppState>,
) -> Result<Vec<CustomProviderResponse>, ApiError> {
    let config = state.config.read().await;
    let result = config
        .custom_providers
        .iter()
        .map(|cp| CustomProviderResponse {
            id: cp.id.clone(),
            name: cp.name.clone(),
            base_url: cp.base_url.clone(),
            model_id: cp.model_id.clone(),
        })
        .collect();
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn store_custom_provider(
    state: State<'_, AppState>,
    request: CustomProviderRequest,
) -> Result<CustomProviderResponse, ApiError> {
    // Validate fields
    if request.id.is_empty() {
        return Err(ApiError::invalid_input("Provider ID cannot be empty"));
    }
    if request.name.is_empty() {
        return Err(ApiError::invalid_input("Provider name cannot be empty"));
    }
    if request.base_url.is_empty() {
        return Err(ApiError::invalid_input("Base URL cannot be empty"));
    }
    if request.model_id.is_empty() {
        return Err(ApiError::invalid_input("Model ID cannot be empty"));
    }

    // Validate connectivity
    let validator = ApiKeyValidator::new();
    validator
        .validate_custom(&request.base_url, &request.api_key, &request.model_id)
        .await
        .map_err(ApiError::api_key_error)?;

    // Persist
    let mut config = state.config.write().await;
    let cp = CustomProvider {
        id: request.id.clone(),
        name: request.name.clone(),
        base_url: request.base_url.clone(),
        api_key: request.api_key.clone(),
        model_id: request.model_id.clone(),
    };
    config.add_custom_provider(cp);
    config
        .save()
        .map_err(|e| ApiError::file_error(e.to_string()))?;

    Ok(CustomProviderResponse {
        id: request.id,
        name: request.name,
        base_url: request.base_url,
        model_id: request.model_id,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_custom_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), ApiError> {
    let mut config = state.config.write().await;
    config.remove_custom_provider(&id);
    config
        .save()
        .map_err(|e| ApiError::file_error(e.to_string()))?;
    Ok(())
}
