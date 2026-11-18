// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscrowFixture} from "./Base.t.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";

/// Reenters the escrow from inside a token transfer (for the reentrancy test).
contract ReentrantToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    HedgedEscrow public target;
    bytes32 public key;
    bool public attack;

    function setTarget(HedgedEscrow t, bytes32 k) external {
        target = t;
        key = k;
        attack = true;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        balanceOf[from] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        if (attack) {
            attack = false;
            target.claimRefund(key); // must hit the reentrancy guard
        }
        return true;
    }
}

/// tests/escrow/settlement.test.ts + security.test.ts.
contract SettlementTest is EscrowFixture {
    bytes32 internal p;

    function setUp() public override {
        super.setUp();
        p = _promo();
    }

    // ---------------------------------------------------------- claim_refund, cancelled purchase

    function test_refund_cancelled_exactAmountTerminal() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _cancel(k);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.claimRefund(k);
        assertEq(usdc.balanceOf(alice), before + OFFER, "refund");
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.Refunded), "terminal");
        assertEq(esc.getPromo(p).totalPaidOut, OFFER, "accounting");
        assertEq(esc.outstanding(p), 0, "nothing outstanding");
    }

    function test_refund_cancelled_whilePausedAndAfterEitherOutcome() public {
        bytes32 a = _deposit(p, alice, _id(0));
        bytes32 b = _deposit(p, bob, _id(0));
        _cancel(a);
        _cancel(b);
        esc.setPaused(true);
        vm.prank(alice);
        esc.claimRefund(a);
        esc.setPaused(false);
        _resolve(p, HedgedEscrow.Outcome.No);
        vm.prank(bob);
        esc.claimRefund(b);
    }

    function test_refund_cancelled_noDoubleClaim() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _cancel(k);
        vm.prank(alice);
        esc.claimRefund(k);
        uint256 vault = usdc.balanceOf(address(esc));
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimRefund(k);
        assertEq(usdc.balanceOf(address(esc)), vault, "no more tokens");
    }

    // ---------------------------------------------------------- claim_refund, hedged purchase

    function test_refund_hedged_afterYes() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        esc.claimRefund(k);
        assertEq(usdc.balanceOf(alice), before + OFFER, "yes refund");
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.ClaimedByCustomer), "terminal");
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimRefund(k);
    }

    function test_refund_hedged_pausedThenUnpaused() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        esc.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.claimRefund(k);
        esc.setPaused(false);
        vm.prank(alice);
        esc.claimRefund(k);
    }

    function test_refund_hedged_rejectedBeforeResolutionAndAfterNo() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimRefund(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimRefund(k);
        vm.prank(merchant);
        esc.claimMerchant(k);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimRefund(k);
    }

    function test_refund_rejectsDepositedAndOtherSigners() public {
        bytes32 k = _deposit(p, alice, _id(0));
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimRefund(k);
        _cancel(k);
        address[4] memory who = [bob, merchant, relayer, admin];
        for (uint256 i = 0; i < who.length; i++) {
            vm.prank(who[i]);
            vm.expectRevert(HedgedEscrow.Unauthorized.selector);
            esc.claimRefund(k);
        }
    }

    function test_refund_cannotUseOnePurchaseForAnothersFunds() public {
        bytes32 a = _deposit(p, alice, _id(0));
        bytes32 b = _deposit(p, bob, _id(0));
        _cancel(b);
        vm.prank(alice); // alice's own purchase is not cancelled; bob's is not hers
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.claimRefund(b);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimRefund(a);
    }

    // ---------------------------------------------------------- claim_merchant

    function test_merchant_afterNo() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        uint256 before = usdc.balanceOf(merchant);
        vm.prank(merchant);
        esc.claimMerchant(k);
        assertEq(usdc.balanceOf(merchant), before + OFFER, "payout");
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.ClaimedByMerchant), "terminal");
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimMerchant(k);
    }

    function test_merchant_rejectedBeforeResolutionAndAfterYes() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimMerchant(k);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimMerchant(k);
    }

    function test_merchant_neverGetsDepositedOrCancelled() public {
        bytes32 d = _deposit(p, alice, _id(0));
        bytes32 c = _deposit(p, bob, _id(0));
        _cancel(c);
        _resolve(p, HedgedEscrow.Outcome.No);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimMerchant(d);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimMerchant(c);
        vm.prank(bob);
        esc.claimRefund(c);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimMerchant(c);
    }

    function test_merchant_rejectsOtherSignersAndOtherMerchantsPromo() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        address[4] memory who = [alice, merchant2, relayer, admin];
        for (uint256 i = 0; i < who.length; i++) {
            vm.prank(who[i]);
            vm.expectRevert(HedgedEscrow.Unauthorized.selector);
            esc.claimMerchant(k);
        }
    }

    function test_merchant_pausedThenUnpaused() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        esc.setPaused(true);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.claimMerchant(k);
        esc.setPaused(false);
        vm.prank(merchant);
        esc.claimMerchant(k);
    }

    // ---------------------------------------------------------- pooled funds

    function test_pool_noOutcome_mixed() public {
        bytes32 a = _deposit(p, alice, _id(0));
        bytes32 b = _deposit(p, bob, _id(0));
        bytes32 c = _deposit(p, mallory, _id(0));
        _hedge(a);
        _hedge(b);
        _cancel(c);
        _resolve(p, HedgedEscrow.Outcome.No);
        uint256 m0 = usdc.balanceOf(merchant);
        vm.startPrank(merchant);
        esc.claimMerchant(a);
        esc.claimMerchant(b);
        vm.stopPrank();
        vm.prank(mallory);
        esc.claimRefund(c);
        assertEq(usdc.balanceOf(merchant), m0 + 2 * OFFER, "merchant gets hedged");
        assertEq(usdc.balanceOf(address(esc)), 0, "vault empty");
        assertEq(esc.outstanding(p), 0, "balanced");
    }

    function test_pool_yes_eachOwnAmount() public {
        bytes32 a = _deposit(p, alice, _id(0));
        bytes32 b = _deposit(p, bob, _id(0));
        _hedge(a);
        _hedge(b);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(alice);
        esc.claimRefund(a);
        vm.prank(bob);
        esc.claimRefund(b);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector); // state check precedes the outcome check, as in Anchor
        esc.claimMerchant(a);
        assertEq(usdc.balanceOf(address(esc)), 0, "vault empty");
    }

    function test_pool_promoIsolation() public {
        bytes32 p2 = _promo(merchant2, 1);
        bytes32 a = _deposit(p, alice, _id(0));
        _deposit(p2, bob, _id(0));
        _cancel(a);
        vm.prank(alice);
        esc.claimRefund(a);
        assertEq(esc.getPromo(p2).totalPaidOut, 0, "p2 untouched");
        assertEq(esc.outstanding(p2), OFFER, "p2 still owed");
        assertEq(usdc.balanceOf(address(esc)), OFFER, "only p2 funds remain");
    }

    function test_pool_donationNotClaimable() public {
        bytes32 a = _deposit(p, alice, _id(0));
        usdc.mint(address(esc), 77 * 1e6); // donation
        _cancel(a);
        vm.prank(alice);
        esc.claimRefund(a);
        assertEq(usdc.balanceOf(address(esc)), 77 * 1e6, "donation stays");
        assertEq(esc.outstanding(p), 0, "accounting unaffected");
    }

    // ---------------------------------------------------------- pause matrix (docs/interfaces.md §2)

    function test_pauseMatrix() public {
        bytes32 hNo = _deposit(p, alice, _id(0));
        bytes32 dep = _deposit(p, bob, _id(0));
        bytes32 can = _deposit(p, mallory, _id(0));
        _hedge(hNo);
        _cancel(can);
        esc.setPaused(true);
        // blocked
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.initializePromo(9, OFFER, deadline, "m");
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.deposit(p, _id(9), OFFER);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.markHedged(dep);
        vm.warp(deadline);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
        // allowed
        esc.setRelayer(relayer);
        esc.setCancelTimeout(TIMEOUT);
        vm.prank(relayer);
        esc.cancelUnhedged(dep);
        vm.prank(mallory);
        esc.claimRefund(can);
        // merchant claim blocked while paused (needs a resolved promo: unpause, resolve, re-pause)
        esc.setPaused(false);
        vm.prank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.No);
        esc.setPaused(true);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.claimMerchant(hNo);
        // D3: pause never moves funds
        assertEq(esc.outstanding(p), 2 * OFFER, "hedged + cancelled-unclaimed still owed");
    }

    // ---------------------------------------------------------- reentrancy

    function test_reentrancyBlocked() public {
        ReentrantToken t = new ReentrantToken();
        HedgedEscrow e = new HedgedEscrow(address(t), relayer, TIMEOUT);
        vm.prank(merchant);
        bytes32 pr = e.initializePromo(1, OFFER, deadline, "m");
        t.mint(alice, 2 * OFFER);
        vm.prank(alice);
        bytes32 k1 = e.deposit(pr, _id(0), OFFER);
        vm.prank(alice);
        bytes32 k2 = e.deposit(pr, _id(1), OFFER);
        vm.startPrank(relayer);
        e.cancelUnhedged(k1);
        e.cancelUnhedged(k2);
        vm.stopPrank();
        t.setTarget(e, k2);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector); // inner Reentrancy bubbles as a failed transfer
        e.claimRefund(k1);
        assertEq(uint8(e.getPurchase(k1).state), uint8(HedgedEscrow.PurchaseState.Cancelled), "rolled back");
    }

    // ---------------------------------------------------------- conservation across a mixed lifecycle

    function test_conservation_mixed() public {
        bytes32 p2 = _promo(merchant2, 1);
        bytes32[] memory promos = new bytes32[](2);
        promos[0] = p;
        promos[1] = p2;
        bytes32 a = _deposit(p, alice, _id(0));
        bytes32 b = _deposit(p, bob, _id(0));
        bytes32 c = _deposit(p2, alice, _id(0));
        bytes32 d = _deposit(p2, mallory, _id(0));
        _assertConserved(promos);
        _hedge(a);
        _cancel(b);
        _hedge(c);
        vm.warp(T0 + TIMEOUT);
        vm.prank(mallory);
        esc.cancelExpiredDeposit(d);
        _assertConserved(promos);
        vm.prank(bob);
        esc.claimRefund(b);
        vm.prank(mallory);
        esc.claimRefund(d);
        _assertConserved(promos);
        vm.warp(deadline);
        vm.startPrank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        esc.resolvePromo(p2, HedgedEscrow.Outcome.No);
        vm.stopPrank();
        vm.prank(alice);
        esc.claimRefund(a);
        vm.prank(merchant2);
        esc.claimMerchant(c);
        _assertConserved(promos);
        assertEq(usdc.balanceOf(address(esc)), 0, "everything paid exactly once");
    }
}
