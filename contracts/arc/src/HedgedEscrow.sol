// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal ERC-20 surface we use. On Arc, USDC's optional ERC-20 interface lives at
///      0x3600000000000000000000000000000000000000 (6 decimals) and shares one balance with the
///      native 18-decimal gas balance (docs.arc.io "EVM differences" / "Contract addresses").
interface IERC20Like {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title HedgedEscrow: Arc (EVM) port of the `programs/escrow` Anchor program.
/// @notice Same 12 operations, same state machines, same authority/pause matrix, same errors
///         (in the same order, so `errorIndex + 6000` equals the Anchor code), same five events.
///         Spec: docs/interfaces.md §1-3 and docs/workflow.md. Differences, all EVM-forced:
///         - `initialize_config` is the constructor (deployer = admin, once).
///         - PDAs become deterministic ids: promoId = keccak256(abi.encode("promo", merchant,
///           nonce)), purchaseKey = keccak256(abi.encode("purchase", promoId, customer,
///           purchaseId)). One contract holds every promo's funds; per-promo accounting
///           (`totalDeposited` / `totalPaidOut`) keeps the "exact per-purchase liability" and
///           "each promo pays out at most what it took in" guarantees of the per-promo vault.
///         - Token "accounts" are wallet addresses: payouts go to the recorded customer /
///           merchant address itself (strictly tighter than the Anchor owner check).
///         - Appended errors (index >= 23) cover cases Anchor reports through system errors.
contract HedgedEscrow {
    // ---------------------------------------------------------------- constants
    uint8 public constant TOKEN_DECIMALS = 6;
    uint256 public constant MAX_MARKET_ID_LEN = 64;
    uint64 public constant MIN_CANCEL_TIMEOUT_SECS = 1;
    uint64 public constant MAX_CANCEL_TIMEOUT_SECS = 30 days;

    // ---------------------------------------------------------------- types (Anchor order)
    enum PromoState {
        Active,
        ResolvedYes,
        ResolvedNo
    }

    enum PurchaseState {
        Deposited,
        Hedged,
        Cancelled,
        Refunded,
        ClaimedByCustomer,
        ClaimedByMerchant
    }

    enum Outcome {
        Yes,
        No
    }

    enum ClaimKind {
        CancelRefund,
        YesRefund,
        MerchantPayout
    }

    struct Promo {
        address merchant;
        uint64 promoNonce;
        uint64 offerAmount;
        uint64 depositDeadline;
        uint64 resolvedAt;
        uint64 totalDeposited;
        uint64 totalPaidOut;
        uint64 purchaseCount;
        uint64 cancelTimeoutSecs;
        PromoState state;
        bool exists;
        string marketId;
    }

    struct Purchase {
        bytes32 promo;
        address customer;
        bytes16 purchaseId;
        uint64 amount;
        PurchaseState state;
        uint64 depositedAt;
        uint64 hedgedAt;
        uint64 cancelledAt;
        uint64 settledAt;
        bool exists;
    }

    // ---------------------------------------------------------------- errors (Anchor order: 6000 + i)
    error Unauthorized(); // 6000
    error Paused(); // 6001
    error InvalidState(); // 6002
    error WrongMint(); // 6003 (unused on EVM: the token is fixed at deploy)
    error WrongTokenAccount(); // 6004 (unused on EVM: payouts go to recorded addresses)
    error DepositClosed(); // 6005
    error WrongAmount(); // 6006
    error PromoNotActive(); // 6007
    error AlreadyResolved(); // 6008
    error AlreadyHedged(); // 6009
    error AlreadyCancelled(); // 6010
    error AlreadyClaimed(); // 6011
    error MarketIdTooLong(); // 6012
    error MathOverflow(); // 6013
    error InvalidOfferAmount(); // 6014
    error InvalidDeadline(); // 6015
    error EmptyMarketId(); // 6016
    error WrongDecimals(); // 6017
    error InvalidRelayer(); // 6018
    error InsufficientVaultFunds(); // 6019
    error ResolutionTooEarly(); // 6020
    error TimeoutNotElapsed(); // 6021
    error InvalidTimeout(); // 6022
    // EVM-only (append-only):
    error PromoAlreadyExists(); // Anchor: `init` on an existing PDA (system "already in use")
    error PurchaseAlreadyExists(); // same, for the purchase
    error AccountNotFound(); // Anchor 3012 AccountNotInitialized
    error Reentrancy();
    error TokenTransferFailed(); // token returned false / reverted / balance delta mismatch

    // ---------------------------------------------------------------- events (same five)
    event DepositEvent(
        bytes32 indexed promo,
        bytes32 indexed purchase,
        address indexed customer,
        bytes16 purchaseId,
        uint64 amount,
        uint64 depositedAt
    );
    event HedgeMarkedEvent(bytes32 indexed promo, bytes32 indexed purchase, address relayer, uint64 markedAt);
    /// Emitted by `cancelUnhedged` (relayer) AND `cancelExpiredDeposit` (customer); same payload.
    event PurchaseCancelledEvent(
        bytes32 indexed promo, bytes32 indexed purchase, address indexed customer, uint64 amount, uint64 cancelledAt
    );
    event ResolutionEvent(bytes32 indexed promo, Outcome outcome, address relayer, uint64 resolvedAt);
    event ClaimEvent(
        bytes32 indexed promo,
        bytes32 indexed purchase,
        address indexed recipient,
        uint64 amount,
        ClaimKind kind,
        uint64 claimedAt
    );

    // ---------------------------------------------------------------- config (Anchor `Config`)
    address public admin;
    address public relayer;
    IERC20Like public immutable token;
    bool public paused;
    uint64 public cancelTimeoutSecs;

    mapping(bytes32 => Promo) private _promos;
    mapping(bytes32 => Purchase) private _purchases;
    mapping(bytes32 => bytes32[]) private _promoPurchases;
    bytes32[] private _promoIds;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice `initialize_config`: the deployer becomes admin, once.
    constructor(address token_, address relayer_, uint64 cancelTimeoutSecs_) {
        if (relayer_ == address(0)) revert InvalidRelayer();
        if (!_validTimeout(cancelTimeoutSecs_)) revert InvalidTimeout();
        if (IERC20Like(token_).decimals() != TOKEN_DECIMALS) revert WrongDecimals();
        admin = msg.sender;
        relayer = relayer_;
        token = IERC20Like(token_);
        cancelTimeoutSecs = cancelTimeoutSecs_;
    }

    // ================================================================ admin (allowed while paused)

    function setPaused(bool paused_) external {
        if (msg.sender != admin) revert Unauthorized();
        paused = paused_;
    }

    function setRelayer(address newRelayer) external {
        if (msg.sender != admin) revert Unauthorized();
        if (newRelayer == address(0)) revert InvalidRelayer();
        relayer = newRelayer;
    }

    /// Applies to FUTURE promos only (each promo snapshots the value at creation).
    function setCancelTimeout(uint64 secs) external {
        if (msg.sender != admin) revert Unauthorized();
        if (!_validTimeout(secs)) revert InvalidTimeout();
        cancelTimeoutSecs = secs;
    }

    // ================================================================ merchant

    /// `initialize_promo`. Blocked while paused.
    function initializePromo(uint64 promoNonce, uint64 offerAmount, uint64 depositDeadline, string calldata marketId)
        external
        returns (bytes32 promoId)
    {
        if (paused) revert Paused();
        promoId = promoIdOf(msg.sender, promoNonce);
        if (_promos[promoId].exists) revert PromoAlreadyExists();
        if (offerAmount == 0) revert InvalidOfferAmount();
        if (bytes(marketId).length == 0) revert EmptyMarketId();
        if (bytes(marketId).length > MAX_MARKET_ID_LEN) revert MarketIdTooLong();
        if (depositDeadline <= block.timestamp) revert InvalidDeadline();

        Promo storage p = _promos[promoId];
        p.merchant = msg.sender;
        p.promoNonce = promoNonce;
        p.offerAmount = offerAmount;
        p.depositDeadline = depositDeadline;
        p.marketId = marketId;
        p.state = PromoState.Active;
        p.cancelTimeoutSecs = cancelTimeoutSecs;
        p.exists = true;
        _promoIds.push(promoId);
    }

    // ================================================================ customer

    /// `deposit`: pulls exactly `offerAmount` (prior `approve` on the token required).
    function deposit(bytes32 promoId, bytes16 purchaseId, uint64 amount)
        external
        nonReentrant
        returns (bytes32 purchaseKey)
    {
        if (paused) revert Paused();
        Promo storage p = _existingPromo(promoId);
        if (p.state != PromoState.Active) revert PromoNotActive();
        purchaseKey = purchaseKeyOf(promoId, msg.sender, purchaseId);
        if (_purchases[purchaseKey].exists) revert PurchaseAlreadyExists();
        uint64 nowTs = _now();
        if (!(nowTs < p.depositDeadline)) revert DepositClosed();
        if (amount != p.offerAmount) revert WrongAmount();
        uint64 totalDeposited = _add(p.totalDeposited, amount);
        uint64 purchaseCount = _add(p.purchaseCount, 1);

        // effects
        p.totalDeposited = totalDeposited;
        p.purchaseCount = purchaseCount;
        _purchases[purchaseKey] = Purchase({
            promo: promoId,
            customer: msg.sender,
            purchaseId: purchaseId,
            amount: amount,
            state: PurchaseState.Deposited,
            depositedAt: nowTs,
            hedgedAt: 0,
            cancelledAt: 0,
            settledAt: 0,
            exists: true
        });
        _promoPurchases[promoId].push(purchaseKey);
        emit DepositEvent(promoId, purchaseKey, msg.sender, purchaseId, amount, nowTs);

        // interaction: exact-amount pull (rejects fee-on-transfer / short transfers)
        uint256 before = token.balanceOf(address(this));
        _call(abi.encodeCall(IERC20Like.transferFrom, (msg.sender, address(this), amount)));
        if (token.balanceOf(address(this)) - before != amount) revert TokenTransferFailed();
    }

    /// `cancel_expired_deposit`: the purchase's customer, once `now >= depositedAt + timeout`.
    /// Allowed while paused and in any promo state. Never for Hedged purchases.
    function cancelExpiredDeposit(bytes32 purchaseKey) external {
        Purchase storage u = _existingPurchase(purchaseKey);
        if (u.customer != msg.sender) revert Unauthorized();
        _requireDepositedForCancel(u);
        Promo storage p = _promos[u.promo];
        uint256 releaseAt = uint256(u.depositedAt) + uint256(p.cancelTimeoutSecs);
        if (releaseAt > type(uint64).max) revert MathOverflow();
        uint64 nowTs = _now();
        if (nowTs < releaseAt) revert TimeoutNotElapsed();
        u.state = PurchaseState.Cancelled;
        u.cancelledAt = nowTs;
        emit PurchaseCancelledEvent(u.promo, purchaseKey, u.customer, u.amount, nowTs);
    }

    /// `claim_refund`: Cancelled -> Refunded (any promo state, allowed while paused), or
    /// Hedged -> ClaimedByCustomer when the promo resolved YES (blocked while paused).
    function claimRefund(bytes32 purchaseKey) external nonReentrant {
        Purchase storage u = _existingPurchase(purchaseKey);
        if (u.customer != msg.sender) revert Unauthorized();
        Promo storage p = _promos[u.promo];
        PurchaseState next;
        ClaimKind kind;
        if (u.state == PurchaseState.Cancelled) {
            (next, kind) = (PurchaseState.Refunded, ClaimKind.CancelRefund);
        } else if (u.state == PurchaseState.Hedged) {
            if (p.state != PromoState.ResolvedYes) revert InvalidState();
            if (paused) revert Paused();
            (next, kind) = (PurchaseState.ClaimedByCustomer, ClaimKind.YesRefund);
        } else if (u.state == PurchaseState.Deposited) {
            revert InvalidState();
        } else {
            revert AlreadyClaimed();
        }
        uint64 amount = u.amount;
        uint64 nowTs = _now();
        u.state = next;
        u.settledAt = nowTs;
        _payFromVault(p, u.customer, amount);
        emit ClaimEvent(u.promo, purchaseKey, u.customer, amount, kind, nowTs);
    }

    /// `claim_merchant`: Hedged -> ClaimedByMerchant when the promo resolved NO. Blocked while paused.
    function claimMerchant(bytes32 purchaseKey) external nonReentrant {
        if (paused) revert Paused();
        Purchase storage u = _existingPurchase(purchaseKey);
        Promo storage p = _promos[u.promo];
        if (p.merchant != msg.sender) revert Unauthorized();
        if (u.state == PurchaseState.Hedged) {
            // ok
        } else if (u.state == PurchaseState.Deposited || u.state == PurchaseState.Cancelled) {
            revert InvalidState();
        } else {
            revert AlreadyClaimed();
        }
        if (p.state != PromoState.ResolvedNo) revert InvalidState();
        uint64 amount = u.amount;
        uint64 nowTs = _now();
        u.state = PurchaseState.ClaimedByMerchant;
        u.settledAt = nowTs;
        _payFromVault(p, p.merchant, amount);
        emit ClaimEvent(u.promo, purchaseKey, p.merchant, amount, ClaimKind.MerchantPayout, nowTs);
    }

    // ================================================================ relayer

    /// `mark_hedged`: Deposited -> Hedged; promo must be Active. Blocked while paused.
    function markHedged(bytes32 purchaseKey) external {
        if (msg.sender != relayer) revert Unauthorized();
        if (paused) revert Paused();
        Purchase storage u = _existingPurchase(purchaseKey);
        if (u.state == PurchaseState.Deposited) {
            // ok
        } else if (u.state == PurchaseState.Cancelled || u.state == PurchaseState.Refunded) {
            revert InvalidState();
        } else {
            revert AlreadyHedged();
        }
        if (_promos[u.promo].state != PromoState.Active) revert PromoNotActive();
        uint64 nowTs = _now();
        u.state = PurchaseState.Hedged;
        u.hedgedAt = nowTs;
        emit HedgeMarkedEvent(u.promo, purchaseKey, msg.sender, nowTs);
    }

    /// `cancel_unhedged`: Deposited -> Cancelled (refund entitlement for the customer). Allowed
    /// while paused and in any promo state: it can only return a customer's own funds.
    function cancelUnhedged(bytes32 purchaseKey) external {
        if (msg.sender != relayer) revert Unauthorized();
        Purchase storage u = _existingPurchase(purchaseKey);
        _requireDepositedForCancel(u);
        uint64 nowTs = _now();
        u.state = PurchaseState.Cancelled;
        u.cancelledAt = nowTs;
        emit PurchaseCancelledEvent(u.promo, purchaseKey, u.customer, u.amount, nowTs);
    }

    /// `resolve_promo`: Active -> ResolvedYes|ResolvedNo exactly once, only at/after the deposit
    /// deadline. Check order: Unauthorized -> Paused -> AlreadyResolved -> ResolutionTooEarly.
    function resolvePromo(bytes32 promoId, Outcome outcome) external {
        if (msg.sender != relayer) revert Unauthorized();
        if (paused) revert Paused();
        Promo storage p = _existingPromo(promoId);
        if (p.state != PromoState.Active) revert AlreadyResolved();
        uint64 nowTs = _now();
        if (nowTs < p.depositDeadline) revert ResolutionTooEarly();
        p.state = outcome == Outcome.Yes ? PromoState.ResolvedYes : PromoState.ResolvedNo;
        p.resolvedAt = nowTs;
        emit ResolutionEvent(promoId, outcome, msg.sender, nowTs);
    }

    // ================================================================ views

    function promoIdOf(address merchant, uint64 promoNonce) public pure returns (bytes32) {
        return keccak256(abi.encode("promo", merchant, promoNonce));
    }

    function purchaseKeyOf(bytes32 promoId, address customer, bytes16 purchaseId) public pure returns (bytes32) {
        return keccak256(abi.encode("purchase", promoId, customer, purchaseId));
    }

    function getPromo(bytes32 promoId) external view returns (Promo memory) {
        return _promos[promoId];
    }

    function getPurchase(bytes32 purchaseKey) external view returns (Purchase memory) {
        return _purchases[purchaseKey];
    }

    /// Outstanding liability = deposits not yet paid out.
    function outstanding(bytes32 promoId) external view returns (uint64) {
        Promo storage p = _promos[promoId];
        return p.totalDeposited - p.totalPaidOut;
    }

    function purchaseCountOf(bytes32 promoId) external view returns (uint256) {
        return _promoPurchases[promoId].length;
    }

    function purchaseKeysOf(bytes32 promoId, uint256 offset, uint256 limit) external view returns (bytes32[] memory out) {
        bytes32[] storage all = _promoPurchases[promoId];
        if (offset >= all.length) return new bytes32[](0);
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        out = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = all[i];
    }

    function promoCount() external view returns (uint256) {
        return _promoIds.length;
    }

    function promoIdAt(uint256 i) external view returns (bytes32) {
        return _promoIds[i];
    }

    // ================================================================ internal

    function _payFromVault(Promo storage p, address to, uint64 amount) private {
        uint64 totalPaidOut = _add(p.totalPaidOut, amount);
        if (totalPaidOut > p.totalDeposited) revert InsufficientVaultFunds();
        if (token.balanceOf(address(this)) < amount) revert InsufficientVaultFunds();
        p.totalPaidOut = totalPaidOut;
        _call(abi.encodeCall(IERC20Like.transfer, (to, amount)));
    }

    function _requireDepositedForCancel(Purchase storage u) private view {
        if (u.state == PurchaseState.Deposited) return;
        if (u.state == PurchaseState.Cancelled || u.state == PurchaseState.Refunded) revert AlreadyCancelled();
        revert InvalidState();
    }

    function _existingPromo(bytes32 promoId) private view returns (Promo storage p) {
        p = _promos[promoId];
        if (!p.exists) revert AccountNotFound();
    }

    function _existingPurchase(bytes32 purchaseKey) private view returns (Purchase storage u) {
        u = _purchases[purchaseKey];
        if (!u.exists) revert AccountNotFound();
    }

    /// SafeERC20-style call: reverts on failure, accepts tokens that return nothing.
    function _call(bytes memory data) private {
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenTransferFailed();
    }

    function _add(uint64 a, uint64 b) private pure returns (uint64) {
        uint256 s = uint256(a) + uint256(b);
        if (s > type(uint64).max) revert MathOverflow();
        return uint64(s);
    }

    function _now() private view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _validTimeout(uint64 secs) private pure returns (bool) {
        return secs >= MIN_CANCEL_TIMEOUT_SECS && secs <= MAX_CANCEL_TIMEOUT_SECS;
    }
}
