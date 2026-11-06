// Task-scoped choices. Never write the default model/provider setting.
export const RECLASSIFICATION_TIERS = ['embeddinggemma2','basic','scene','clip','vlm'];
const PROVIDERS = ['openai','kimi','anthropic','gemini','custom'];
export async function buildReclassificationChoices({isReady,aiCfg,hasKey,localTiers=RECLASSIFICATION_TIERS}) {
  const local = await Promise.all(localTiers.filter(id=>RECLASSIFICATION_TIERS.includes(id)).map(async id => ({id,available:await isReady(id),kind:'local'})));
  const online = await Promise.all(PROVIDERS.map(async provider => {
    const config=aiCfg?.providers?.[provider];
    const configured=!!(config?.model && config?.baseURL);
    const available=configured && !!(config.apiKeyRef && await hasKey(config.apiKeyRef));
    return {id:`online:${provider}`,provider,model:config?.model || '',available,kind:'online'};
  }));
  return [...local,...online];
}
export function resolveReclassificationChoice(choice) {
  if (!choice?.available) throw new Error('Model unavailable');
  if (choice.id.startsWith('online:') && PROVIDERS.includes(choice.provider)) return {forceLocal:false,provider:choice.provider};
  if (!RECLASSIFICATION_TIERS.includes(choice.id)) throw new Error('Unknown model');
  return {forceLocal:true,tier:choice.id,strict:true};
}
