use anchor_lang::prelude::*;

/// Preliminary error codes; extend with the authorization matrix.
#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Invalid state transition")]
    InvalidState,
    #[msg("Wrong token mint")]
    WrongMint,
    #[msg("Deposit window closed")]
    DepositClosed,
    #[msg("Promotion already resolved")]
    AlreadyResolved,
    #[msg("Funds already claimed or cancelled")]
    AlreadySettled,
}
