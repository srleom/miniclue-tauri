use keyring::Entry;

const SERVICE_NAME: &str = "miniclue";

pub struct SecretStore;

impl SecretStore {
    pub fn new() -> Self {
        Self
    }

    fn provider_entry(provider: &str) -> Result<Entry, String> {
        Entry::new(SERVICE_NAME, &format!("provider:{provider}"))
            .map_err(|e| format!("Failed to create keyring entry: {e}"))
    }

    fn custom_provider_entry(id: &str) -> Result<Entry, String> {
        Entry::new(SERVICE_NAME, &format!("custom_provider:{id}"))
            .map_err(|e| format!("Failed to create keyring entry: {e}"))
    }

    pub fn set_provider_key(&self, provider: &str, api_key: &str) -> Result<(), String> {
        let entry = Self::provider_entry(provider)?;
        entry
            .set_password(api_key)
            .map_err(|e| format!("Failed to store provider API key: {e}"))
    }

    pub fn get_provider_key(&self, provider: &str) -> Result<Option<String>, String> {
        let entry = Self::provider_entry(provider)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Failed to read provider API key: {e}")),
        }
    }

    pub fn delete_provider_key(&self, provider: &str) -> Result<(), String> {
        let entry = Self::provider_entry(provider)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete provider API key: {e}")),
        }
    }

    pub fn set_custom_provider_key(&self, id: &str, api_key: &str) -> Result<(), String> {
        let entry = Self::custom_provider_entry(id)?;
        entry
            .set_password(api_key)
            .map_err(|e| format!("Failed to store custom provider API key: {e}"))
    }

    pub fn get_custom_provider_key(&self, id: &str) -> Result<Option<String>, String> {
        let entry = Self::custom_provider_entry(id)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Failed to read custom provider API key: {e}")),
        }
    }

    pub fn delete_custom_provider_key(&self, id: &str) -> Result<(), String> {
        let entry = Self::custom_provider_entry(id)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete custom provider API key: {e}")),
        }
    }
}
