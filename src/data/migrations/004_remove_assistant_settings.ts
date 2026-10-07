/**
 * Migration 004 - Remove the online assistant's settings.
 * The assistant now works offline, so the stored API key and model name are deleted.
 */
export const M004_REMOVE_ASSISTANT_SETTINGS = [
  `DELETE FROM app_settings WHERE key IN ('assistant_api_key', 'assistant_model');`,
].join("\n");
