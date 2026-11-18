// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./utils/Vm.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// Shared fixture: mirrors tests/escrow/helpers.ts (admin, relayer, merchant, customers, 5-token
/// offer, 600 s cancel timeout).
abstract contract EscrowFixture is TestBase {
    HedgedEscrow internal esc;
    MockUSDC internal usdc;

    address internal admin = address(this);
    address internal relayer = vm.addr(0xA11CE);
    address internal merchant = vm.addr(0xB0B);
    address internal merchant2 = vm.addr(0xB0B2);
    address internal alice = vm.addr(0xC1);
    address internal bob = vm.addr(0xC2);
    address internal mallory = vm.addr(0xBAD);

    uint64 internal constant OFFER = 5_000_000;
    uint64 internal constant TIMEOUT = 600;
    uint64 internal constant T0 = 1_000_000;
    uint64 internal deadline;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        esc = new HedgedEscrow(address(usdc), relayer, TIMEOUT);
        deadline = T0 + 3600;
        address[5] memory people = [alice, bob, mallory, merchant, merchant2];
        for (uint256 i = 0; i < people.length; i++) {
            usdc.mint(people[i], 1_000 * 1e6);
            vm.prank(people[i]);
            usdc.approve(address(esc), type(uint256).max);
        }
    }

    // ------------------------------------------------------------- helpers

    function _promo(address m, uint64 nonce) internal returns (bytes32) {
        vm.prank(m);
        return esc.initializePromo(nonce, OFFER, deadline, "gemini:TEXAS-WIN-2026-11-21");
    }

    function _promo() internal returns (bytes32) {
        return _promo(merchant, 1);
    }

    function _deposit(bytes32 promo, address c, bytes16 id) internal returns (bytes32) {
        vm.prank(c);
        return esc.deposit(promo, id, OFFER);
    }

    function _hedge(bytes32 key) internal {
        vm.prank(relayer);
        esc.markHedged(key);
    }

    function _cancel(bytes32 key) internal {
        vm.prank(relayer);
        esc.cancelUnhedged(key);
    }

    function _resolve(bytes32 promo, HedgedEscrow.Outcome o) internal {
        vm.warp(deadline);
        vm.prank(relayer);
        esc.resolvePromo(promo, o);
    }

    function _pstate(bytes32 key) internal view returns (HedgedEscrow.PurchaseState) {
        return esc.getPurchase(key).state;
    }

    function _promoState(bytes32 promo) internal view returns (HedgedEscrow.PromoState) {
        return esc.getPromo(promo).state;
    }

    function _assertConserved(bytes32[] memory promos) internal view {
        uint256 outstanding;
        for (uint256 i = 0; i < promos.length; i++) {
            HedgedEscrow.Promo memory p = esc.getPromo(promos[i]);
            assertTrue(p.totalPaidOut <= p.totalDeposited, "paid out more than deposited");
            outstanding += p.totalDeposited - p.totalPaidOut;
        }
        assertTrue(usdc.balanceOf(address(esc)) >= outstanding, "vault below outstanding");
    }

    function _id(uint256 n) internal pure returns (bytes16) {
        return bytes16(uint128(n + 1));
    }
}
