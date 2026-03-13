export const ONBOARDING_DONE_KEY = 'miniclue_onboarding_done';
export const BG_DOWNLOAD_MODEL_KEY = 'miniclue_bg_download_model_id';
export const BG_DOWNLOAD_MODEL_NAME_KEY = 'miniclue_bg_download_model_name';

export type OnboardingStep = 'welcome' | 'model' | 'api-keys';
export const STEPS: OnboardingStep[] = ['welcome', 'model', 'api-keys'];

export { formatBytes } from '@/lib/utils';
