use tauri::{AppHandle, State};

use crate::catalog::{DEFAULT_MODELS, MODEL_CATALOG};
use crate::config::CustomProvider;
use crate::db;
use crate::error::ApiError;
use crate::models::user::{
    ApiKeyResponse, CustomProviderRequest, CustomProviderResponse, ModelToggle, ModelsResponse,
    ProviderModels, RecentDocument, RecentDocumentsResponse, UserFolder,
};
use crate::services::model_manager::get_bundled_model_name;
use crate::services::validators::ApiKeyValidator;
use crate::state::AppState;

// Display order for standard providers
const PROVIDER_ORDER: &[&str] = &["openai", "gemini", "anthropic", "xai", "deepseek"];

#[tauri::command]
#[specta::specta]
pub async fn get_folders_with_documents(
    state: State<'_, AppState>,
) -> Result<Vec<UserFolder>, ApiError> {
    let folders_with_docs = db::folder::get_folders_with_documents(&state.db).await?;

    let result = folders_with_docs
        .into_iter()
        .map(|(folder, documents)| {
            let user_folder_documents = documents
                .into_iter()
                .map(
                    |(id, title, status, folder_id)| crate::models::user::UserFolderDocument {
                        id,
                        title,
                        status,
                        folder_id,
                    },
                )
                .collect();

            UserFolder {
                id: folder.id,
                title: folder.title,
                description: folder.description,
                is_default: folder.is_default != 0,
                updated_at: folder.updated_at,
                documents: Some(user_folder_documents),
            }
        })
        .collect();

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
    let already_has_key = config.has_provider_key(&provider);
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

    // Store API key in OS keyring first
    state
        .secret_store
        .set_provider_key(&provider, &api_key)
        .map_err(ApiError::security_error)?;

    // Keep provider marker in config (non-secret)
    println!("[store_api_key] Saving provider marker to config file...");
    config.mark_provider_key_configured(&provider);

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
    // Remove from keyring first
    state
        .secret_store
        .delete_provider_key(&provider)
        .map_err(ApiError::security_error)?;

    // Remove from config file
    let mut config = state.config.write().await;
    config.clear_provider_key_configured(&provider);
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
pub async fn list_models(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ModelsResponse, ApiError> {
    let config = state.config.read().await;
    let configured_providers = &config.configured_providers;
    let local_catalog = state.model_manager.get_catalog(&app_handle).await.ok();

    let mut providers = Vec::new();

    for &provider in PROVIDER_ORDER {
        if provider == "deepseek" {
            continue; // Disabled
        }

        let has_key = configured_providers.contains(provider);
        if !has_key {
            continue;
        }

        if let Some(models) = MODEL_CATALOG.get(provider) {
            let toggles: Vec<ModelToggle> = models
                .iter()
                .map(|(id, name, vision)| {
                    let enabled = config.get_model_preference(provider, id);
                    ModelToggle {
                        id: id.to_string(),
                        name: name.to_string(),
                        enabled,
                        vision: *vision,
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
                id: format!("custom:{}", cp.id),
                name: cp.name.clone(),
                enabled: true,
                vision: false,
            }],
        });
    }

    // Append local AI models — one entry per model in `local_chat_enabled_models`.
    let enabled_models: Vec<String> = config.settings.local_chat_enabled_models.clone();

    if !enabled_models.is_empty() {
        let toggles: Vec<ModelToggle> = enabled_models
            .iter()
            .map(|model_id| {
                let name = get_bundled_model_name(model_id).unwrap_or_else(|| model_id.clone());
                let vision = local_catalog
                    .as_ref()
                    .and_then(|c| c.models.iter().find(|m| m.id == *model_id))
                    .map(|m| m.vision)
                    .unwrap_or(false);
                ModelToggle {
                    id: format!("local:{}", model_id),
                    name,
                    enabled: true,
                    vision,
                }
            })
            .collect();

        if !toggles.is_empty() {
            providers.push(ProviderModels {
                provider: "local".to_string(),
                models: toggles,
            });
        }
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

    let (model_name, model_vision) = catalog_models
        .iter()
        .find(|(id, _, _)| *id == model)
        .map(|(_, name, vision)| (*name, *vision))
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
        vision: model_vision,
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

    // Persist secret in keyring first
    state
        .secret_store
        .set_custom_provider_key(&request.id, &request.api_key)
        .map_err(ApiError::security_error)?;

    // Persist non-secret config
    let mut config = state.config.write().await;
    let cp = CustomProvider {
        id: request.id.clone(),
        name: request.name.clone(),
        base_url: request.base_url.clone(),
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
    state
        .secret_store
        .delete_custom_provider_key(&id)
        .map_err(ApiError::security_error)?;

    let mut config = state.config.write().await;
    config.remove_custom_provider(&id);
    config
        .save()
        .map_err(|e| ApiError::file_error(e.to_string()))?;
    Ok(())
}
