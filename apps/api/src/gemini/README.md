# gemini/ (Dev 4)

READ-ONLY Gemini Predictions adapter. **No order placement, no authenticated endpoints, no keys.**
`client.ts` only issues GETs to an allowlist of public paths and never sends credentials.

Verified live on 2026-11-16 (base `https://api.gemini.com`, OpenAPI:
`https://developer.gemini.com/specs/openapi/prediction-markets.yaml`):

| Need         | Endpoint                                                                 | Notes                                                    |
| ------------ | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| List markets | `GET /v1/prediction-markets/events?status=active&search=&category=`      | paginated `{data, pagination}`                           |
| One event    | `GET /v1/prediction-markets/events/{eventTicker}`                        | also works after settlement                              |
| Order book   | `GET /v1/book/{instrumentSymbol}`                                        | asks `{price, amount}`; **400 once the contract closes** |
| Settlement   | contract `status: "settled"`, `resolutionSide: "yes"/"no"`, `resolvedAt` | official; never infer from price                         |

- `marketId` = contract `instrumentSymbol` = `GEMI-<eventTicker>-<contractTicker>`.
- Prices are decimal strings ("0.93"); quantities step by 0.01 (`quantityIncrement`). `decimal.ts`
  converts both exactly with bigint (no floats).
- Not yet known: rate limits and trading fees for prediction markets (fees default to 0 bps, labeled
  "not modeled").

Demo markets with real official outcomes (no fixtures needed):

- Texas WIN: `GEMI-NCAAF-2609122330-OSU-TEX-M-TEX` (Ohio State vs Texas, 2026-09-12)
- Texas LOSS: `GEMI-NCAAF-2610101930-TEX-OU-M-TEX` (Texas vs Oklahoma, 2026-10-10)
- Live this week: `GEMI-NCAAF-2611212030-ARK-TEX-M-TEX` (Arkansas vs Texas, Sat 2026-11-21)
