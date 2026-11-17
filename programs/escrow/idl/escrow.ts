/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/escrow.json`.
 */
export type Escrow = {
  address: "E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr";
  metadata: {
    name: "escrow";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Hedged refund promotions — escrow program (Devnet MVP)";
  };
  instructions: [
    {
      name: "cancelUnhedged";
      discriminator: [198, 51, 225, 178, 14, 169, 96, 221];
      accounts: [
        {
          name: "relayer";
          signer: true;
        },
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "promo";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 114, 111, 109, 111];
              },
              {
                kind: "account";
                path: "promo.merchant";
                account: "promo";
              },
              {
                kind: "account";
                path: "promo.promo_nonce";
                account: "promo";
              },
            ];
          };
          relations: ["purchase"];
        },
        {
          name: "purchase";
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "deposit";
      discriminator: [242, 35, 198, 137, 82, 225, 242, 182];
      accounts: [
        {
          name: "customer";
          writable: true;
          signer: true;
        },
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "promo";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 114, 111, 109, 111];
              },
              {
                kind: "account";
                path: "promo.merchant";
                account: "promo";
              },
              {
                kind: "account";
                path: "promo.promo_nonce";
                account: "promo";
              },
            ];
          };
        },
        {
          name: "mint";
        },
        {
          name: "purchase";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 117, 114, 99, 104, 97, 115, 101];
              },
              {
                kind: "account";
                path: "promo";
              },
              {
                kind: "account";
                path: "customer";
              },
              {
                kind: "arg";
                path: "purchaseId";
              },
            ];
          };
        },
        {
          name: "customerTokenAccount";
          writable: true;
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "purchaseId";
          type: {
            array: ["u8", 16];
          };
        },
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "initializeConfig";
      discriminator: [208, 127, 21, 1, 194, 190, 196, 70];
      accounts: [
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "mint";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "relayer";
          type: "pubkey";
        },
      ];
    },
    {
      name: "initializePromo";
      discriminator: [52, 108, 19, 60, 159, 89, 102, 72];
      accounts: [
        {
          name: "merchant";
          writable: true;
          signer: true;
        },
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "mint";
        },
        {
          name: "promo";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 114, 111, 109, 111];
              },
              {
                kind: "account";
                path: "merchant";
              },
              {
                kind: "arg";
                path: "promoNonce";
              },
            ];
          };
        },
        {
          name: "vault";
          docs: ["The single pooled vault: ATA of the Promo PDA (the PDA is the token authority)."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "promo";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "mint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "promoNonce";
          type: "u64";
        },
        {
          name: "offerAmount";
          type: "u64";
        },
        {
          name: "depositDeadline";
          type: "i64";
        },
        {
          name: "marketId";
          type: "string";
        },
      ];
    },
    {
      name: "markHedged";
      discriminator: [71, 115, 80, 81, 125, 127, 63, 172];
      accounts: [
        {
          name: "relayer";
          signer: true;
        },
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "promo";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 114, 111, 109, 111];
              },
              {
                kind: "account";
                path: "promo.merchant";
                account: "promo";
              },
              {
                kind: "account";
                path: "promo.promo_nonce";
                account: "promo";
              },
            ];
          };
          relations: ["purchase"];
        },
        {
          name: "purchase";
          docs: [
            "Must be this promo's purchase: seeds bind (promo, customer, purchase_id) to the account.",
          ];
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "resolvePromo";
      discriminator: [229, 176, 166, 195, 170, 115, 250, 198];
      accounts: [
        {
          name: "relayer";
          signer: true;
        },
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "promo";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 114, 111, 109, 111];
              },
              {
                kind: "account";
                path: "promo.merchant";
                account: "promo";
              },
              {
                kind: "account";
                path: "promo.promo_nonce";
                account: "promo";
              },
            ];
          };
        },
      ];
      args: [
        {
          name: "outcome";
          type: {
            defined: {
              name: "outcome";
            };
          };
        },
      ];
    },
    {
      name: "setPaused";
      discriminator: [91, 60, 125, 192, 176, 225, 166, 218];
      accounts: [
        {
          name: "admin";
          signer: true;
          relations: ["config"];
        },
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
      ];
      args: [
        {
          name: "paused";
          type: "bool";
        },
      ];
    },
    {
      name: "setRelayer";
      discriminator: [23, 243, 33, 88, 110, 84, 196, 37];
      accounts: [
        {
          name: "admin";
          signer: true;
          relations: ["config"];
        },
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
      ];
      args: [
        {
          name: "newRelayer";
          type: "pubkey";
        },
      ];
    },
  ];
  accounts: [
    {
      name: "config";
      discriminator: [155, 12, 170, 224, 30, 250, 204, 130];
    },
    {
      name: "promo";
      discriminator: [56, 91, 197, 41, 229, 168, 221, 54];
    },
    {
      name: "purchase";
      discriminator: [33, 203, 1, 252, 231, 228, 8, 67];
    },
  ];
  events: [
    {
      name: "claimEvent";
      discriminator: [93, 15, 70, 170, 48, 140, 212, 219];
    },
    {
      name: "depositEvent";
      discriminator: [120, 248, 61, 83, 31, 142, 107, 144];
    },
    {
      name: "hedgeMarkedEvent";
      discriminator: [183, 113, 124, 116, 73, 42, 196, 29];
    },
    {
      name: "purchaseCancelledEvent";
      discriminator: [105, 201, 64, 171, 239, 81, 150, 111];
    },
    {
      name: "resolutionEvent";
      discriminator: [58, 223, 109, 183, 183, 149, 169, 251];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "unauthorized";
      msg: "Unauthorized signer";
    },
    {
      code: 6001;
      name: "paused";
      msg: "Program is paused";
    },
    {
      code: 6002;
      name: "invalidState";
      msg: "Invalid state transition";
    },
    {
      code: 6003;
      name: "wrongMint";
      msg: "Wrong token mint";
    },
    {
      code: 6004;
      name: "wrongTokenAccount";
      msg: "Wrong token account or vault";
    },
    {
      code: 6005;
      name: "depositClosed";
      msg: "Deposit window closed";
    },
    {
      code: 6006;
      name: "wrongAmount";
      msg: "Deposit amount must equal the promotion offer amount";
    },
    {
      code: 6007;
      name: "promoNotActive";
      msg: "Promotion is not active";
    },
    {
      code: 6008;
      name: "alreadyResolved";
      msg: "Promotion already resolved";
    },
    {
      code: 6009;
      name: "alreadyHedged";
      msg: "Purchase already hedged";
    },
    {
      code: 6010;
      name: "alreadyCancelled";
      msg: "Purchase already cancelled";
    },
    {
      code: 6011;
      name: "alreadyClaimed";
      msg: "Funds already claimed";
    },
    {
      code: 6012;
      name: "marketIdTooLong";
      msg: "Market id too long";
    },
    {
      code: 6013;
      name: "mathOverflow";
      msg: "Arithmetic overflow";
    },
    {
      code: 6014;
      name: "invalidOfferAmount";
      msg: "Offer amount must be greater than zero";
    },
    {
      code: 6015;
      name: "invalidDeadline";
      msg: "Deposit deadline must be in the future";
    },
    {
      code: 6016;
      name: "emptyMarketId";
      msg: "Market id must not be empty";
    },
    {
      code: 6017;
      name: "wrongDecimals";
      msg: "Mint must have 6 decimals";
    },
    {
      code: 6018;
      name: "invalidRelayer";
      msg: "Relayer must not be the default (all-zero) key";
    },
  ];
  types: [
    {
      name: "claimEvent";
      docs: [
        "Emitted by `claim_refund` (CancelRefund | YesRefund) and `claim_merchant` (MerchantPayout).",
      ];
      type: {
        kind: "struct";
        fields: [
          {
            name: "promo";
            type: "pubkey";
          },
          {
            name: "purchase";
            type: "pubkey";
          },
          {
            name: "recipient";
            docs: ["Owner of the destination token account (customer or merchant)."];
            type: "pubkey";
          },
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "kind";
            type: {
              defined: {
                name: "claimKind";
              };
            };
          },
          {
            name: "claimedAt";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "claimKind";
      type: {
        kind: "enum";
        variants: [
          {
            name: "cancelRefund";
          },
          {
            name: "yesRefund";
          },
          {
            name: "merchantPayout";
          },
        ];
      };
    },
    {
      name: "config";
      docs: [
        'Global singleton. PDA: ["config"]. Holds the single MVP relayer, the admin and the pause flag.',
      ];
      type: {
        kind: "struct";
        fields: [
          {
            name: "admin";
            type: "pubkey";
          },
          {
            name: "relayer";
            docs: ["The one authorized relayer: mark_hedged, cancel_unhedged, resolve_promo."];
            type: "pubkey";
          },
          {
            name: "mint";
            docs: ["The only accepted mint (mock USD, 6 decimals)."];
            type: "pubkey";
          },
          {
            name: "paused";
            type: "bool";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "depositEvent";
      docs: ["Emitted by `deposit`."];
      type: {
        kind: "struct";
        fields: [
          {
            name: "promo";
            type: "pubkey";
          },
          {
            name: "purchase";
            type: "pubkey";
          },
          {
            name: "customer";
            type: "pubkey";
          },
          {
            name: "purchaseId";
            type: {
              array: ["u8", 16];
            };
          },
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "depositedAt";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "hedgeMarkedEvent";
      docs: ["Emitted by `mark_hedged`."];
      type: {
        kind: "struct";
        fields: [
          {
            name: "promo";
            type: "pubkey";
          },
          {
            name: "purchase";
            type: "pubkey";
          },
          {
            name: "relayer";
            type: "pubkey";
          },
          {
            name: "markedAt";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "outcome";
      type: {
        kind: "enum";
        variants: [
          {
            name: "yes";
          },
          {
            name: "no";
          },
        ];
      };
    },
    {
      name: "promo";
      docs: [
        'PDA: ["promo", merchant, promo_nonce.to_le_bytes()]. Also the authority of the vault ATA.',
      ];
      type: {
        kind: "struct";
        fields: [
          {
            name: "merchant";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "vault";
            docs: ["ATA(promo PDA, mint). Stored for cheap verification; always re-derivable."];
            type: "pubkey";
          },
          {
            name: "promoNonce";
            type: "u64";
          },
          {
            name: "offerAmount";
            docs: ["Exact amount every deposit must equal (demo: 5_000_000)."];
            type: "u64";
          },
          {
            name: "depositDeadline";
            docs: ["Unix seconds; deposits rejected at/after this."];
            type: "i64";
          },
          {
            name: "marketId";
            docs: ["Exact Gemini market identifier (used for quotes AND final settlement)."];
            type: "string";
          },
          {
            name: "state";
            type: {
              defined: {
                name: "promoState";
              };
            };
          },
          {
            name: "resolvedAt";
            docs: ["0 until resolved."];
            type: "i64";
          },
          {
            name: "totalDeposited";
            type: "u64";
          },
          {
            name: "totalPaidOut";
            docs: ["Sum of all vault payouts (refunds + merchant payouts)."];
            type: "u64";
          },
          {
            name: "purchaseCount";
            type: "u64";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "promoState";
      type: {
        kind: "enum";
        variants: [
          {
            name: "active";
          },
          {
            name: "resolvedYes";
          },
          {
            name: "resolvedNo";
          },
        ];
      };
    },
    {
      name: "purchase";
      docs: ['PDA: ["purchase", promo, customer, purchase_id (16 bytes)]. One per deposit.'];
      type: {
        kind: "struct";
        fields: [
          {
            name: "promo";
            type: "pubkey";
          },
          {
            name: "customer";
            type: "pubkey";
          },
          {
            name: "purchaseId";
            docs: [
              "Client-generated unique id (UUIDv4 bytes). Allows many purchases per customer.",
            ];
            type: {
              array: ["u8", 16];
            };
          },
          {
            name: "amount";
            docs: [
              "This purchase's liability inside the shared vault (== promo.offer_amount at deposit).",
            ];
            type: "u64";
          },
          {
            name: "state";
            type: {
              defined: {
                name: "purchaseState";
              };
            };
          },
          {
            name: "depositedAt";
            type: "i64";
          },
          {
            name: "hedgedAt";
            docs: ["0 if never set."];
            type: "i64";
          },
          {
            name: "cancelledAt";
            type: "i64";
          },
          {
            name: "settledAt";
            type: "i64";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "purchaseCancelledEvent";
      docs: ["Emitted by `cancel_unhedged`."];
      type: {
        kind: "struct";
        fields: [
          {
            name: "promo";
            type: "pubkey";
          },
          {
            name: "purchase";
            type: "pubkey";
          },
          {
            name: "customer";
            type: "pubkey";
          },
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "cancelledAt";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "purchaseState";
      docs: [
        "Purchase escrow lifecycle. Terminal states: Refunded, ClaimedByCustomer, ClaimedByMerchant.",
      ];
      type: {
        kind: "enum";
        variants: [
          {
            name: "deposited";
          },
          {
            name: "hedged";
          },
          {
            name: "cancelled";
          },
          {
            name: "refunded";
          },
          {
            name: "claimedByCustomer";
          },
          {
            name: "claimedByMerchant";
          },
        ];
      };
    },
    {
      name: "resolutionEvent";
      docs: ["Emitted by `resolve_promo`."];
      type: {
        kind: "struct";
        fields: [
          {
            name: "promo";
            type: "pubkey";
          },
          {
            name: "outcome";
            type: {
              defined: {
                name: "outcome";
              };
            };
          },
          {
            name: "relayer";
            type: "pubkey";
          },
          {
            name: "resolvedAt";
            type: "i64";
          },
        ];
      };
    },
  ];
};
