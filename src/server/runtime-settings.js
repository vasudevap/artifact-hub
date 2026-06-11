import { config, getFeatureAvailability } from "../../config.js";
import { getSystemSettings } from "./admin-store.js";

async function getEffectiveAiStatus(user) {
  const settings = await getSystemSettings();
  const configuredFeatures = getFeatureAvailability(user);
  const configuredAi = configuredFeatures.aiAssistant;
  const effectiveAi =
    settings.aiEnabledOverride === null
      ? configuredAi
      : configuredAi && settings.aiEnabledOverride;

  return {
    configuredAiEnabled: configuredAi,
    effectiveAiEnabled: effectiveAi,
    outboundApiCallsEnabled: settings.outboundApiCallsEnabled,
    provider: config.ai.provider,
    model: config.ai.model,
    reasoningEffort: config.ai.reasoningEffort,
    settings,
  };
}

async function getEffectiveFeatureAvailability(user) {
  const configured = getFeatureAvailability(user);
  const aiStatus = await getEffectiveAiStatus(user);
  return {
    ...configured,
    aiAssistant: aiStatus.effectiveAiEnabled,
  };
}

export { getEffectiveAiStatus, getEffectiveFeatureAvailability };
