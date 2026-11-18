// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscrowFixture} from "./Base.t.sol";
import {TestBase} from "./utils/Vm.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// Random sequences of every operation by every actor; ghost accounting checked by the invariants.
contract Handler is TestBase {
    HedgedEscrow public esc;
    MockUSDC public usdc;
    address public relayer;
    address[3] public customers;
    address[2] public merchants;
    bytes32[] public promos;
    bytes32[] public keys;
    mapping(bytes32 => uint256) public paidCount; // per purchase payouts observed
    uint256 public ghostPaid;
    uint256 public ghostDeposited;
    uint64 internal nonce;

    constructor(HedgedEscrow e, MockUSDC u, address r, address[3] memory c, address[2] memory m) {
        esc = e;
        usdc = u;
        relayer = r;
        customers = c;
        merchants = m;
    }

    function keysLength() external view returns (uint256) {
        return keys.length;
    }

    function promosLength() external view returns (uint256) {
        return promos.length;
    }

    function newPromo(uint256 mi, uint64 offer, uint32 window) external {
        offer = uint64(bound(offer, 1, 1_000_000_000));
        window = uint32(bound(window, 1, 7 days));
        address m = merchants[mi % 2];
        vm.prank(m);
        try esc.initializePromo(++nonce, offer, uint64(block.timestamp) + window, "fuzz") returns (bytes32 id) {
            promos.push(id);
        } catch {}
    }

    function deposit(uint256 pi, uint256 ci, uint128 rawId) external {
        if (promos.length == 0) return;
        bytes32 p = promos[pi % promos.length];
        address c = customers[ci % 3];
        uint64 amount = esc.getPromo(p).offerAmount;
        vm.prank(c);
        try esc.deposit(p, bytes16(rawId), amount) returns (bytes32 k) {
            keys.push(k);
            ghostDeposited += amount;
        } catch {}
    }

    function hedge(uint256 ki) external {
        if (keys.length == 0) return;
        vm.prank(relayer);
        try esc.markHedged(keys[ki % keys.length]) {} catch {}
    }

    function cancel(uint256 ki) external {
        if (keys.length == 0) return;
        vm.prank(relayer);
        try esc.cancelUnhedged(keys[ki % keys.length]) {} catch {}
    }

    function timeoutCancel(uint256 ki) external {
        if (keys.length == 0) return;
        bytes32 k = keys[ki % keys.length];
        vm.prank(esc.getPurchase(k).customer);
        try esc.cancelExpiredDeposit(k) {} catch {}
    }

    function resolve(uint256 pi, bool yes) external {
        if (promos.length == 0) return;
        vm.prank(relayer);
        try esc.resolvePromo(promos[pi % promos.length], yes ? HedgedEscrow.Outcome.Yes : HedgedEscrow.Outcome.No) {}
            catch {}
    }

    function claimRefund(uint256 ki, uint256 who) external {
        if (keys.length == 0) return;
        bytes32 k = keys[ki % keys.length];
        address caller = who % 4 == 0 ? customers[who % 3] : esc.getPurchase(k).customer; // sometimes a stranger
        uint256 before = usdc.balanceOf(address(esc));
        vm.prank(caller);
        try esc.claimRefund(k) {
            paidCount[k]++;
            ghostPaid += before - usdc.balanceOf(address(esc));
        } catch {}
    }

    function claimMerchant(uint256 ki, uint256 who) external {
        if (keys.length == 0) return;
        bytes32 k = keys[ki % keys.length];
        address caller = who % 4 == 0 ? merchants[who % 2] : esc.getPromo(esc.getPurchase(k).promo).merchant;
        uint256 before = usdc.balanceOf(address(esc));
        vm.prank(caller);
        try esc.claimMerchant(k) {
            paidCount[k]++;
            ghostPaid += before - usdc.balanceOf(address(esc));
        } catch {}
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 days));
    }

    function togglePause(bool on) external {
        vm.prank(esc.admin());
        esc.setPaused(on);
    }

    function bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }
}

contract InvariantTest is EscrowFixture {
    Handler internal h;

    function setUp() public override {
        super.setUp();
        address[3] memory c = [alice, bob, mallory];
        address[2] memory m = [merchant, merchant2];
        h = new Handler(esc, usdc, relayer, c, m);
        esc.setPaused(false);
        // admin is this test contract; let the handler pause through a prank of admin
        for (uint256 i = 0; i < 3; i++) {
            usdc.mint(c[i], 1e15);
        }
        targetContract(address(h));
    }

    address[] private _targets;

    function targetContract(address t) internal {
        _targets.push(t);
    }

    function targetContracts() public view returns (address[] memory) {
        return _targets;
    }

    /// The vault always covers every promo's outstanding liability, and no promo ever pays out
    /// more than it took in.
    function invariant_conservation() public view {
        uint256 outstandingSum;
        for (uint256 i = 0; i < h.promosLength(); i++) {
            HedgedEscrow.Promo memory p = esc.getPromo(h.promos(i));
            require(p.totalPaidOut <= p.totalDeposited, "overpaid promo");
            outstandingSum += p.totalDeposited - p.totalPaidOut;
        }
        require(usdc.balanceOf(address(esc)) == outstandingSum, "vault != outstanding (no donations here)");
        require(h.ghostDeposited() - h.ghostPaid() == outstandingSum, "ghost mismatch");
    }

    /// Every purchase is paid at most once, and a paid purchase is in a terminal state.
    function invariant_noDoubleClaim() public view {
        for (uint256 i = 0; i < h.keysLength(); i++) {
            bytes32 k = h.keys(i);
            uint256 n = h.paidCount(k);
            require(n <= 1, "paid twice");
            HedgedEscrow.PurchaseState s = esc.getPurchase(k).state;
            bool terminal = s == HedgedEscrow.PurchaseState.Refunded
                || s == HedgedEscrow.PurchaseState.ClaimedByCustomer || s == HedgedEscrow.PurchaseState.ClaimedByMerchant;
            require(terminal == (n == 1), "terminal <=> paid once");
        }
    }

    /// A merchant payout only ever happens under a NO resolution; a YES refund only under YES.
    function invariant_payoutMatchesOutcome() public view {
        for (uint256 i = 0; i < h.keysLength(); i++) {
            HedgedEscrow.Purchase memory u = esc.getPurchase(h.keys(i));
            HedgedEscrow.PromoState ps = esc.getPromo(u.promo).state;
            if (u.state == HedgedEscrow.PurchaseState.ClaimedByMerchant) {
                require(ps == HedgedEscrow.PromoState.ResolvedNo, "merchant paid without NO");
            }
            if (u.state == HedgedEscrow.PurchaseState.ClaimedByCustomer) {
                require(ps == HedgedEscrow.PromoState.ResolvedYes, "yes refund without YES");
            }
        }
    }
}

contract FuzzTest is EscrowFixture {
    /// Any interleaving of hedge/cancel attempts leaves exactly one winner per purchase.
    function testFuzz_hedgeCancelExclusive(uint8 order, uint32 dt) public {
        bytes32 p = _promo();
        bytes32 k = _deposit(p, alice, _id(0));
        vm.warp(T0 + (uint64(dt) % (2 * TIMEOUT)));
        bool hedged;
        bool cancelled;
        for (uint256 i = 0; i < 4; i++) {
            uint256 op = (order >> (2 * i)) & 3;
            if (op == 0) {
                vm.prank(relayer);
                try esc.markHedged(k) {
                    hedged = true;
                } catch {}
            } else if (op == 1) {
                vm.prank(relayer);
                try esc.cancelUnhedged(k) {
                    cancelled = true;
                } catch {}
            } else {
                vm.prank(alice);
                try esc.cancelExpiredDeposit(k) {
                    cancelled = true;
                } catch {}
            }
        }
        require(!(hedged && cancelled), "both won");
    }

    /// Claims by arbitrary callers never pay anyone but the entitled party, and never twice.
    function testFuzz_claimsOnlyEntitledOnce(address caller, bool yes, bool hedgeIt) public {
        vm.assume(caller != address(0));
        bytes32 p = _promo();
        bytes32 k = _deposit(p, alice, _id(0));
        if (hedgeIt) _hedge(k);
        else _cancel(k);
        _resolve(p, yes ? HedgedEscrow.Outcome.Yes : HedgedEscrow.Outcome.No);
        uint256 vault = usdc.balanceOf(address(esc));
        vm.prank(caller);
        try esc.claimRefund(k) {
            require(caller == alice, "stranger refunded");
            require(!hedgeIt || yes, "refund on NO");
        } catch {}
        vm.prank(caller);
        try esc.claimMerchant(k) {
            require(caller == merchant && hedgeIt && !yes, "bad merchant payout");
        } catch {}
        require(vault - usdc.balanceOf(address(esc)) <= OFFER, "paid more than one deposit");
    }

    /// Deposit amount must equal the offer exactly.
    function testFuzz_depositAmountExact(uint64 amount) public {
        bytes32 p = _promo();
        vm.prank(alice);
        if (amount != OFFER) vm.expectRevert(HedgedEscrow.WrongAmount.selector);
        esc.deposit(p, _id(0), amount);
    }
}
