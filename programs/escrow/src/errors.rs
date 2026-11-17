use anchor_lang::prelude::*;

/// Error codes. "Already ..." errors let off-chain callers treat retries as idempotent (the
/// gateway re-reads state and reports `alreadyApplied`).
#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Program is paused")]
    Paused,
    #[msg("Invalid state transition")]
    InvalidState,
    #[msg("Wrong token mint")]
    WrongMint,
    #[msg("Wrong token account or vault")]
    WrongTokenAccount,
    #[msg("Deposit window closed")]
    DepositClosed,
    #[msg("Deposit amount must equal the promotion offer amount")]
    WrongAmount,
    #[msg("Promotion is not active")]
    PromoNotActive,
    #[msg("Promotion already resolved")]
    AlreadyResolved,
    #[msg("Purchase already hedged")]
    AlreadyHedged,
    #[msg("Purchase already cancelled")]
    AlreadyCancelled,
    #[msg("Funds already claimed")]
    AlreadyClaimed,
    #[msg("Market id too long")]
    MarketIdTooLong,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Offer amount must be greater than zero")]
    InvalidOfferAmount,
    #[msg("Deposit deadline must be in the future")]
    InvalidDeadline,
    #[msg("Market id must not be empty")]
    EmptyMarketId,
    #[msg("Mint must have 6 decimals")]
    WrongDecimals,
    #[msg("Relayer must not be the default (all-zero) key")]
    InvalidRelayer,
}
