import {
  extractMoveClassification,
  extractConfidence,
  extractLikelyDriver,
  extractSecondaryDriver,
} from '../server/notifications.js'

const sample = `[SNDK] [+4.2%] [in the last 45 minutes]

Likely driver: Strong after-hours demand after a storage capacity deal.

Secondary driver: Sector peers also bid higher on AI server spend.

Move classification: 70% company-specific, 30% sector/market/macro-related.

Confidence: High — the partnership announcement is timely and company-specific.`

console.log({
  likely: extractLikelyDriver(sample),
  secondary: extractSecondaryDriver(sample),
  move: extractMoveClassification(sample),
  confidence: extractConfidence(sample),
})
