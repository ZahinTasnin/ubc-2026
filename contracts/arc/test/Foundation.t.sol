// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscrowFixture} from "./Base.t.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";
import {Vm} from "./utils/Vm.sol";

contract SixDecimalsNot {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

/// tests/escrow/foundation.test.ts + the config parts of relayer/timeout tests.
contract FoundationTest is EscrowFixture {
    // ---------------------------------------------------------- initialize_config (constructor)

    function test_config_rejectsNon6DecimalToken() public {
        SixDecimalsNot t = new SixDecimalsNot();
        vm.expectRevert(HedgedEscrow.WrongDecimals.selector);
        new HedgedEscrow(address(t), relayer, TIMEOUT);
    }

    function test_config_rejectsZeroRelayer() public {
        vm.expectRevert(HedgedEscrow.InvalidRelayer.selector);
        new HedgedEscrow(address(usdc), address(0), TIMEOUT);
    }

    function test_config_rejectsTimeoutOutOfRange() public {
        vm.expectRevert(HedgedEscrow.InvalidTimeout.selector);
        new HedgedEscrow(address(usdc), relayer, 0);
        vm.expectRevert(HedgedEscrow.InvalidTimeout.selector);
        new HedgedEscrow(address(usdc), relayer, 30 days + 1);
    }

    function test_config_createsSingleton() public view {
        assertEq(esc.admin(), admin, "admin");
        assertEq(esc.relayer(), relayer, "relayer");
        assertEq(address(esc.token()), address(usdc), "token");
        assertTrue(!esc.paused(), "not paused");
        assertEq(esc.cancelTimeoutSecs(), TIMEOUT, "timeout");
    }

    function test_setPaused_rejectsNonAdmin() public {
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.setPaused(true);
    }

    // ---------------------------------------------------------- initialize_promo

    function test_promo_created() public {
        bytes32 p = _promo();
        HedgedEscrow.Promo memory pr = esc.getPromo(p);
        assertEq(pr.merchant, merchant, "merchant");
        assertEq(pr.offerAmount, OFFER, "offer");
        assertEq(pr.depositDeadline, deadline, "deadline");
        assertEq(uint8(pr.state), uint8(HedgedEscrow.PromoState.Active), "active");
        assertEq(pr.cancelTimeoutSecs, TIMEOUT, "snapshot");
        assertEq(p, esc.promoIdOf(merchant, 1), "derived id");
        assertEq(esc.promoCount(), 1, "listed");
    }

    function test_promo_severalNonces() public {
        bytes32 a = _promo(merchant, 1);
        bytes32 b = _promo(merchant, 2);
        assertTrue(a != b, "distinct ids");
    }

    function test_promo_rejectsDuplicateNonce() public {
        _promo();
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.PromoAlreadyExists.selector);
        esc.initializePromo(1, OFFER, deadline, "m");
    }

    function test_promo_sameNonceDifferentMerchants() public {
        assertTrue(_promo(merchant, 1) != _promo(merchant2, 1), "per-merchant namespace");
    }

    function test_promo_rejectsZeroOffer() public {
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidOfferAmount.selector);
        esc.initializePromo(1, 0, deadline, "m");
    }

    function test_promo_rejectsEmptyMarket() public {
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.EmptyMarketId.selector);
        esc.initializePromo(1, OFFER, deadline, "");
    }

    function test_promo_marketIdLength() public {
        bytes memory m64 = new bytes(64);
        for (uint256 i = 0; i < 64; i++) m64[i] = "x";
        vm.prank(merchant);
        esc.initializePromo(1, OFFER, deadline, string(m64));
        bytes memory m65 = abi.encodePacked(m64, "x");
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.MarketIdTooLong.selector);
        esc.initializePromo(2, OFFER, deadline, string(m65));
    }

    function test_promo_rejectsPastOrNowDeadline() public {
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidDeadline.selector);
        esc.initializePromo(1, OFFER, T0, "m");
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidDeadline.selector);
        esc.initializePromo(1, OFFER, T0 - 1, "m");
    }

    function test_promo_blockedWhilePaused() public {
        esc.setPaused(true);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.initializePromo(1, OFFER, deadline, "m");
    }

    // ---------------------------------------------------------- deposit

    function test_deposit_locksTokens() public {
        bytes32 p = _promo();
        uint256 before = usdc.balanceOf(alice);
        bytes32 k = _deposit(p, alice, _id(0));
        assertEq(usdc.balanceOf(alice), before - OFFER, "customer debited");
        assertEq(usdc.balanceOf(address(esc)), OFFER, "vault credited");
        HedgedEscrow.Purchase memory u = esc.getPurchase(k);
        assertEq(uint8(u.state), uint8(HedgedEscrow.PurchaseState.Deposited), "deposited");
        assertEq(u.customer, alice, "customer");
        assertEq(u.amount, OFFER, "amount");
        assertEq(u.depositedAt, T0, "stamp");
        assertEq(k, esc.purchaseKeyOf(p, alice, _id(0)), "derived key");
        HedgedEscrow.Promo memory pr = esc.getPromo(p);
        assertEq(pr.totalDeposited, OFFER, "total");
        assertEq(pr.purchaseCount, 1, "count");
        assertEq(esc.purchaseCountOf(p), 1, "listed");
    }

    function test_deposit_emitsEvent() public {
        bytes32 p = _promo();
        vm.recordLogs();
        bytes32 k = _deposit(p, alice, _id(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("DepositEvent(bytes32,bytes32,address,bytes16,uint64,uint64)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(esc) && logs[i].topics[0] == sig) {
                assertEq(logs[i].topics[1], p, "promo topic");
                assertEq(logs[i].topics[2], k, "purchase topic");
                assertEq(logs[i].topics[3], bytes32(uint256(uint160(alice))), "customer topic");
                (bytes16 pid, uint64 amount, uint64 at) = abi.decode(logs[i].data, (bytes16, uint64, uint64));
                assertTrue(pid == _id(0), "purchase id");
                assertEq(amount, OFFER, "amount");
                assertEq(at, T0, "deposited at");
                found = true;
            }
        }
        assertTrue(found, "DepositEvent emitted");
    }

    function test_deposit_rejectsWrongAmount() public {
        bytes32 p = _promo();
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.WrongAmount.selector);
        esc.deposit(p, _id(0), OFFER - 1);
    }

    function test_deposit_rejectsReusedPurchaseId() public {
        bytes32 p = _promo();
        _deposit(p, alice, _id(0));
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.PurchaseAlreadyExists.selector);
        esc.deposit(p, _id(0), OFFER);
    }

    function test_deposit_insufficientBalanceCreatesNothing() public {
        bytes32 p = _promo();
        address poor = vm.addr(0xD00D);
        vm.prank(poor);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(poor);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.deposit(p, _id(0), OFFER);
        assertTrue(!esc.getPurchase(esc.purchaseKeyOf(p, poor, _id(0))).exists, "no purchase");
        assertEq(esc.getPromo(p).totalDeposited, 0, "no accounting");
    }

    function test_deposit_noAllowanceFails() public {
        bytes32 p = _promo();
        address c = vm.addr(0xD00E);
        usdc.mint(c, OFFER);
        vm.prank(c);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.deposit(p, _id(0), OFFER);
    }

    function test_deposit_unknownPromo() public {
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AccountNotFound.selector);
        esc.deposit(bytes32(uint256(123)), _id(0), OFFER);
    }

    function test_deposit_rejectedAtAndAfterDeadline() public {
        bytes32 p = _promo();
        vm.warp(deadline - 1);
        _deposit(p, alice, _id(0));
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.DepositClosed.selector);
        esc.deposit(p, _id(1), OFFER);
    }

    function test_deposit_blockedWhilePaused() public {
        bytes32 p = _promo();
        esc.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.deposit(p, _id(0), OFFER);
    }

    // ---------------------------------------------------------- multiple purchases

    function test_multi_trackedSeparatelyPooledFunds() public {
        bytes32 p = _promo();
        bytes32 a1 = _deposit(p, alice, _id(0));
        bytes32 a2 = _deposit(p, alice, _id(1));
        bytes32 b1 = _deposit(p, bob, _id(0));
        assertTrue(a1 != a2 && a1 != b1, "distinct keys");
        assertEq(esc.getPromo(p).totalDeposited, 3 * OFFER, "pooled total");
        assertEq(usdc.balanceOf(address(esc)), 3 * OFFER, "pooled vault");
        assertEq(esc.purchaseCountOf(p), 3, "three listed");
        bytes32[] memory keys = esc.purchaseKeysOf(p, 0, 10);
        assertEq(keys.length, 3, "page");
        assertEq(keys[1], a2, "order");
    }

    function test_multi_promosIndependent() public {
        bytes32 p1 = _promo(merchant, 1);
        bytes32 p2 = _promo(merchant2, 1);
        _deposit(p1, alice, _id(0));
        _deposit(p2, alice, _id(0));
        _deposit(p2, bob, _id(0));
        assertEq(esc.getPromo(p1).totalDeposited, OFFER, "p1");
        assertEq(esc.getPromo(p2).totalDeposited, 2 * OFFER, "p2");
    }

    function test_multi_samePurchaseIdDifferentCustomers() public {
        bytes32 p = _promo();
        assertTrue(_deposit(p, alice, _id(0)) != _deposit(p, bob, _id(0)), "keys differ");
    }

    // ---------------------------------------------------------- set_relayer / set_cancel_timeout

    function test_setRelayer_rotates() public {
        bytes32 p = _promo();
        bytes32 k = _deposit(p, alice, _id(0));
        address newR = vm.addr(0x7777);
        esc.setRelayer(newR);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.markHedged(k);
        vm.prank(newR);
        esc.markHedged(k);
    }

    function test_setRelayer_rejectsNonAdminIncludingRelayer() public {
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.setRelayer(mallory);
    }

    function test_setRelayer_rejectsZero() public {
        vm.expectRevert(HedgedEscrow.InvalidRelayer.selector);
        esc.setRelayer(address(0));
    }

    function test_setRelayer_worksWhilePaused() public {
        esc.setPaused(true);
        esc.setRelayer(mallory);
        assertEq(esc.relayer(), mallory, "rotated while paused");
    }

    function test_admin_hasNoRelayerPowers() public {
        bytes32 p = _promo();
        bytes32 k = _deposit(p, alice, _id(0));
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.markHedged(k);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.cancelUnhedged(k);
    }

    function test_setCancelTimeout_adminOnlyRangeAndFutureOnly() public {
        vm.prank(mallory);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.setCancelTimeout(5);
        vm.expectRevert(HedgedEscrow.InvalidTimeout.selector);
        esc.setCancelTimeout(0);
        vm.expectRevert(HedgedEscrow.InvalidTimeout.selector);
        esc.setCancelTimeout(30 days + 1);
        bytes32 p1 = _promo(merchant, 1);
        esc.setPaused(true);
        esc.setCancelTimeout(5); // works while paused
        esc.setPaused(false);
        bytes32 p2 = _promo(merchant, 2);
        assertEq(esc.getPromo(p1).cancelTimeoutSecs, TIMEOUT, "old promo keeps snapshot");
        assertEq(esc.getPromo(p2).cancelTimeoutSecs, 5, "new promo gets new value");
    }

    // ---------------------------------------------------------- error-code parity with Anchor

    function test_errorSelectorsAreDistinct() public pure {
        bytes4[5] memory s = [
            HedgedEscrow.AlreadyHedged.selector,
            HedgedEscrow.AlreadyCancelled.selector,
            HedgedEscrow.AlreadyResolved.selector,
            HedgedEscrow.AlreadyClaimed.selector,
            HedgedEscrow.ResolutionTooEarly.selector
        ];
        for (uint256 i = 0; i < s.length; i++) {
            for (uint256 j = i + 1; j < s.length; j++) {
                require(s[i] != s[j], "dup selector");
            }
        }
    }
}
