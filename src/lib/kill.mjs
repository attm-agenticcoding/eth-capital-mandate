// Chain cohorts retained for descriptive network context only.
// The former seven-vote exit engine was retired on 2026-10-06: its proxies
// did not identify SoV failure and unknown values could produce false verdicts.
export const ETH_ALIGNED_CHAINS = [
  'Ethereum', 'Base', 'Arbitrum', 'OP Mainnet', 'Optimism', 'Polygon', 'Polygon zkEVM',
  'zkSync Era', 'Scroll', 'Linea', 'Starknet', 'Mantle', 'Blast', 'Mode', 'Zora', 'Taiko',
  'Manta', 'Metis', 'Fraxtal', 'Ink', 'Soneium', 'Unichain', 'World Chain', 'Abstract',
];

// A maintained comparison cohort, not an economic guarantee. Keep exclusions
// explicit and version any future membership changes before interpreting trends.
const STRICT_ALIGNMENT_EXCLUDE = new Set(['Polygon', 'Mantle', 'Manta', 'Metis', 'Fraxtal']);
export const ETH_ALIGNED_CHAINS_STRICT = ETH_ALIGNED_CHAINS.filter((c) => !STRICT_ALIGNMENT_EXCLUDE.has(c));


export function computeKill() {
  return {
    status: 'retired', criteria: [], triggered: null, hitCount: null,
    reason: 'No calibrated exit rule. Review the separated evidence and data gaps.',
  };
}
