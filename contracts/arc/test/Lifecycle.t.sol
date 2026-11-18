// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscrowFixture} from "./Base.t.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";

/// tests/escrow/lifecycle.test.ts + timeout.test.ts: mark_hedged, cancel_unhedged, resolve_promo,
/// cancel_expired_deposit.
contract LifecycleTest is EscrowFixture {
    bytes32 internal p;
    bytes32 internal k;

    function setUp() public override {
        super.setUp();
        p = _promo();
        k = _deposit(p, alice, _id(0));
    }

    // ---------------------------------------------------------- mark_hedged

    function test_markHedged_movesStateNoTokens() public {
        uint256 vault = usdc.balanceOf(address(esc));
        vm.warp(T0 + 10);
        _hedge(k);
        HedgedEscrow.Purchase memory u = esc.getPurchase(k);
        assertEq(uint8(u.state), uint8(HedgedEscrow.PurchaseState.Hedged), "hedged");
        assertEq(u.hedgedAt, T0 + 10, "stamp");
        assertEq(usdc.balanceOf(address(esc)), vault, "no tokens moved");
    }

    function test_markHedged_rejectsNonRelayer() public {
        address[3] memory who = [alice, merchant, mallory];
        for (uint256 i = 0; i < who.length; i++) {
            vm.prank(who[i]);
            vm.expectRevert(HedgedEscrow.Unauthorized.selector);
            esc.markHedged(k);
        }
    }

    function test_markHedged_replayIsAlreadyHedged() public {
        _hedge(k);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyHedged.selector);
        esc.markHedged(k);
    }

    function test_markHedged_cancelledIsInvalidState() public {
        _cancel(k);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.markHedged(k);
    }

    function test_markHedged_blockedWhilePaused() public {
        esc.setPaused(true);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.markHedged(k);
    }

    function test_markHedged_onlyNamedPurchase() public {
        bytes32 k2 = _deposit(p, bob, _id(0));
        _hedge(k);
        assertEq(uint8(_pstate(k2)), uint8(HedgedEscrow.PurchaseState.Deposited), "other untouched");
    }

    function test_markHedged_unknownPurchase() public {
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AccountNotFound.selector);
        esc.markHedged(p); // a promo id is not a purchase key (type confusion)
    }

    function test_markHedged_afterResolutionIsPromoNotActive() public {
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.PromoNotActive.selector);
        esc.markHedged(k);
    }

    function test_markHedged_hedgedStaysAlreadyHedgedAfterResolution() public {
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyHedged.selector);
        esc.markHedged(k);
    }

    // ---------------------------------------------------------- cancel_unhedged

    function test_cancelUnhedged_keepsFundsEscrowed() public {
        uint256 vault = usdc.balanceOf(address(esc));
        _cancel(k);
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.Cancelled), "cancelled");
        assertEq(usdc.balanceOf(address(esc)), vault, "funds stay until claim");
    }

    function test_cancelUnhedged_rejectsNonRelayer() public {
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.cancelUnhedged(k);
    }

    function test_cancelUnhedged_neverCancelsHedged() public {
        _hedge(k);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.cancelUnhedged(k);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.cancelUnhedged(k);
    }

    function test_cancelUnhedged_replayIsAlreadyCancelled() public {
        _cancel(k);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyCancelled.selector);
        esc.cancelUnhedged(k);
    }

    function test_cancelUnhedged_allowedWhilePausedAndAfterResolution() public {
        bytes32 k2 = _deposit(p, bob, _id(0));
        esc.setPaused(true);
        _cancel(k);
        esc.setPaused(false);
        _resolve(p, HedgedEscrow.Outcome.No);
        _cancel(k2);
        assertEq(uint8(_pstate(k2)), uint8(HedgedEscrow.PurchaseState.Cancelled), "post-resolution cancel");
    }

    function test_hedgeAndCancelMutuallyExclusive() public {
        _hedge(k);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.cancelUnhedged(k);
        bytes32 k2 = _deposit(p, bob, _id(0));
        _cancel(k2);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.markHedged(k2);
    }

    // ---------------------------------------------------------- resolve_promo

    function test_resolve_yesAndNoOnce() public {
        bytes32 p2 = _promo(merchant, 2);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        _resolve(p2, HedgedEscrow.Outcome.No);
        assertEq(uint8(_promoState(p)), uint8(HedgedEscrow.PromoState.ResolvedYes), "yes");
        assertEq(uint8(_promoState(p2)), uint8(HedgedEscrow.PromoState.ResolvedNo), "no");
        assertEq(esc.getPromo(p).resolvedAt, deadline, "stamp");
    }

    function test_resolve_rejectsNonRelayer() public {
        vm.warp(deadline);
        address[3] memory who = [merchant, alice, mallory];
        for (uint256 i = 0; i < who.length; i++) {
            vm.prank(who[i]);
            vm.expectRevert(HedgedEscrow.Unauthorized.selector);
            esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        }
    }

    function test_resolve_oneTimeAndCannotFlip() public {
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyResolved.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyResolved.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
        assertEq(uint8(_promoState(p)), uint8(HedgedEscrow.PromoState.ResolvedYes), "first stands");
    }

    function test_resolve_pausedThenUnpaused() public {
        vm.warp(deadline);
        esc.setPaused(true);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
        esc.setPaused(false);
        vm.prank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
    }

    function test_resolve_onlyNamedPromo_unknownPromo() public {
        bytes32 p2 = _promo(merchant, 2);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        assertEq(uint8(_promoState(p2)), uint8(HedgedEscrow.PromoState.Active), "other active");
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AccountNotFound.selector);
        esc.resolvePromo(k, HedgedEscrow.Outcome.Yes); // purchase key passed as promo
    }

    function test_resolve_closesDepositsTouchesNothingElse() public {
        uint256 vault = usdc.balanceOf(address(esc));
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(bob);
        vm.expectRevert(HedgedEscrow.PromoNotActive.selector);
        esc.deposit(p, _id(5), OFFER);
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.Deposited), "purchase untouched");
        assertEq(usdc.balanceOf(address(esc)), vault, "vault untouched");
    }

    function test_resolve_emptyPromo() public {
        bytes32 p2 = _promo(merchant, 2);
        _resolve(p2, HedgedEscrow.Outcome.No);
    }

    // D4 deadline enforcement
    function test_resolve_tooEarlyLeavesActive() public {
        vm.warp(deadline - 1);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.ResolutionTooEarly.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.ResolutionTooEarly.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
        assertEq(uint8(_promoState(p)), uint8(HedgedEscrow.PromoState.Active), "still active");
        // deposits, hedging and cancelling still work before the deadline
        bytes32 k2 = _deposit(p, bob, _id(0));
        _hedge(k2);
        _cancel(k);
    }

    function test_resolve_noGapNoOverlap() public {
        vm.warp(deadline - 1);
        _deposit(p, bob, _id(0)); // open
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.ResolutionTooEarly.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        vm.warp(deadline);
        vm.prank(bob);
        vm.expectRevert(HedgedEscrow.DepositClosed.selector);
        esc.deposit(p, _id(1), OFFER);
        vm.prank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
    }

    function test_resolve_checkOrder() public {
        vm.warp(deadline - 1);
        // Unauthorized beats timing
        vm.prank(mallory);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        // Paused beats timing
        esc.setPaused(true);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        esc.setPaused(false);
        // AlreadyResolved beats timing (different promo resolved, then rewind impossible: use a new promo)
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyResolved.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
    }

    // ---------------------------------------------------------- cancel_expired_deposit (D2)

    function test_timeout_rejectedBeforeElapsed() public {
        vm.warp(T0 + TIMEOUT - 1);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.TimeoutNotElapsed.selector);
        esc.cancelExpiredDeposit(k);
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.Deposited), "unchanged");
    }

    function test_timeout_cancelsAtBoundaryThenRefundsOnce() public {
        vm.warp(T0 + TIMEOUT);
        uint256 vault = usdc.balanceOf(address(esc));
        vm.prank(alice);
        esc.cancelExpiredDeposit(k);
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.Cancelled), "cancelled");
        assertEq(usdc.balanceOf(address(esc)), vault, "no tokens moved yet");
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.claimRefund(k);
        assertEq(usdc.balanceOf(alice), before + OFFER, "refunded exactly");
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimRefund(k);
    }

    function test_timeout_worksWhilePausedIncludingRefund() public {
        vm.warp(T0 + TIMEOUT);
        esc.setPaused(true);
        vm.prank(alice);
        esc.cancelExpiredDeposit(k);
        vm.prank(alice);
        esc.claimRefund(k);
    }

    function test_timeout_worksOnResolvedPromo() public {
        _resolve(p, HedgedEscrow.Outcome.Yes); // deadline > T0 + TIMEOUT
        vm.prank(alice);
        esc.cancelExpiredDeposit(k);
    }

    function test_timeout_perPurchase() public {
        vm.warp(T0 + 300);
        bytes32 k2 = _deposit(p, alice, _id(1));
        vm.warp(T0 + TIMEOUT);
        vm.prank(alice);
        esc.cancelExpiredDeposit(k);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.TimeoutNotElapsed.selector);
        esc.cancelExpiredDeposit(k2);
    }

    function test_timeout_onlyOwnCustomer() public {
        vm.warp(T0 + TIMEOUT);
        address[5] memory who = [relayer, merchant, admin, bob, mallory];
        for (uint256 i = 0; i < who.length; i++) {
            vm.prank(who[i]);
            vm.expectRevert(HedgedEscrow.Unauthorized.selector);
            esc.cancelExpiredDeposit(k);
        }
    }

    function test_timeout_neverCancelsHedged() public {
        _hedge(k);
        vm.warp(T0 + 30 days);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.cancelExpiredDeposit(k);
        // a hedged purchase still goes to the merchant after NO, however late
        vm.prank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
        vm.prank(merchant);
        esc.claimMerchant(k);
    }

    function test_timeout_replayAndRelayerCancelled() public {
        vm.warp(T0 + TIMEOUT);
        vm.prank(alice);
        esc.cancelExpiredDeposit(k);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyCancelled.selector);
        esc.cancelExpiredDeposit(k);
        vm.prank(alice);
        esc.claimRefund(k);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyCancelled.selector);
        esc.cancelExpiredDeposit(k);
        bytes32 k2 = _deposit(p, bob, _id(0));
        _cancel(k2);
        vm.warp(block.timestamp + TIMEOUT);
        vm.prank(bob);
        vm.expectRevert(HedgedEscrow.AlreadyCancelled.selector);
        esc.cancelExpiredDeposit(k2);
    }

    function test_timeout_markHedgedLosesRace() public {
        vm.warp(T0 + TIMEOUT);
        vm.prank(alice);
        esc.cancelExpiredDeposit(k);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.markHedged(k);
    }
}
