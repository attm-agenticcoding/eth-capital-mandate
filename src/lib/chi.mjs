// Compatibility tombstone. Original scores remain in versioned legacy history.
// No total or price-probability mapping is produced by the evidence framework.
export const CHI_COMPONENTS = [];
export const STATED_PRIOR = null;
export function mapProbabilities() { return null; }
export function computeCHI() {
  return { status: 'retired', total: null, maxTotal: null, litCount: null,
    components: [], unscored: [], reverseLit: null, probabilities: null,
    reason: 'Adoption proxies do not calibrate SoV outcomes or price probabilities.' };
}
