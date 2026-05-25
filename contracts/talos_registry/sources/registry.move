// SPDX-License-Identifier: MIT
//
// TalosRegistry — Sui Move package for Talos Protocol.
//
// Handles:
//   - Talos creation (on-chain id + metadata)
//   - Mitos token configuration metadata
//   - Patron equity split (creator / investor / treasury)
//   - Kernel policy (approval threshold, GTM budget)
//   - Walrus blob references for off-chain activity logs
//
// Each Talos is created as a shared object so multiple actors
// (creator + patrons + protocol) can read/mutate state in parallel
// transactions through PTBs.
module talos_registry::registry;

use std::string::{Self, String};
use sui::display;
use sui::event;
use sui::package;
use sui::table::{Self, Table};
use sui::tx_context::sender;

// ─── Errors ─────────────────────────────────────────────────────────

const EUnauthorized: u64 = 1;
const EInvalidShares: u64 = 2;
const ETalosNotActive: u64 = 3;

// ─── Constants ──────────────────────────────────────────────────────

const PROTOCOL_FEE_BPS: u16 = 300; // 3%

// ─── Data Types ─────────────────────────────────────────────────────

/// Patron equity structure — basis points must sum to 10_000 (100%).
public struct Patron has store, copy, drop {
    creator_share: u16,
    investor_share: u16,
    treasury_share: u16,
    creator_addr: address,
    investor_addr: address,
    treasury_addr: address,
}

/// Kernel governance policy.
public struct Kernel has store, copy, drop {
    approval_threshold: u64, // in USDC micro units (6 decimals)
    gtm_budget: u64,         // in USDC micro units
    min_patron_pulse: u64,   // minimum Mitos balance to be a Patron
}

/// Mitos token metadata (the actual Coin<T> lives in a separate Move module).
public struct Mitos has store, copy, drop {
    total_supply: u64,
    price_usd_micros: u64,  // price per token in USDC micro units
    token_symbol: String,
}

/// The Talos on-chain object — shared so it's accessible to all participants.
public struct Talos has key, store {
    id: UID,
    talos_id: u64,
    name: String,
    category: String,
    description: String,
    creator: address,
    patron: Patron,
    kernel: Kernel,
    mitos: Mitos,
    /// Walrus blob id holding extended profile / avatar / long description.
    walrus_profile_blob: vector<u8>,
    /// Walrus blob ids for activity log batches (append-only ring of recent batches).
    walrus_activity_blobs: vector<vector<u8>>,
    created_at_ms: u64,
    active: bool,
}

/// Global registry — singleton shared object holding the talos counter and an
/// index from talos_id -> object id for cheap lookup.
public struct Registry has key {
    id: UID,
    next_talos_id: u64,
    protocol_wallet: address,
    protocol_fee_bps: u16,
    /// talos_id -> on-chain object id
    talos_index: Table<u64, ID>,
}

/// One-time witness used to publish the registry singleton on package init.
public struct REGISTRY has drop {}

// ─── Events ─────────────────────────────────────────────────────────

public struct TalosCreated has copy, drop {
    talos_id: u64,
    object_id: ID,
    creator: address,
    name: String,
}

public struct PatronUpdated has copy, drop {
    talos_id: u64,
    creator_share: u16,
    investor_share: u16,
    treasury_share: u16,
}

public struct ActivityBatchRecorded has copy, drop {
    talos_id: u64,
    walrus_blob_id: vector<u8>,
}

public struct ProfileUpdated has copy, drop {
    talos_id: u64,
    walrus_blob_id: vector<u8>,
}

// ─── Init ───────────────────────────────────────────────────────────

/// Module initializer — runs exactly once on publish, creates the shared
/// Registry singleton and registers a `display::Display<Talos>` so that
/// Sui wallets, SuiVision and SuiScan render the Talos object with a
/// nice profile card (name, agent handle, profile image from Walrus).
fun init(otw: REGISTRY, ctx: &mut TxContext) {
    let registry = Registry {
        id: object::new(ctx),
        next_talos_id: 1,
        protocol_wallet: sender(ctx),
        protocol_fee_bps: PROTOCOL_FEE_BPS,
        talos_index: table::new(ctx),
    };
    transfer::share_object(registry);

    // Sui Display standard — explorers/wallets pull these template strings
    // and substitute `{field_name}` against the Talos struct fields.
    let publisher = package::claim(otw, ctx);
    let mut talos_display = display::new<Talos>(&publisher, ctx);
    display::add(&mut talos_display, string::utf8(b"name"), string::utf8(b"{name}"));
    display::add(
        &mut talos_display,
        string::utf8(b"description"),
        string::utf8(b"{description}"),
    );
    // Walrus-hosted profile blob (PNG / JPG / SVG). Aggregator URL is
    // hard-coded against the public testnet aggregator; bump per network
    // by republishing.
    display::add(
        &mut talos_display,
        string::utf8(b"image_url"),
        string::utf8(b"https://aggregator.walrus-testnet.walrus.space/v1/blobs/{walrus_profile_blob}"),
    );
    display::add(
        &mut talos_display,
        string::utf8(b"project_url"),
        string::utf8(b"https://talos-sui.vercel.app/agents/{talos_id}"),
    );
    display::add(
        &mut talos_display,
        string::utf8(b"creator"),
        string::utf8(b"Talos Protocol"),
    );
    display::update_version(&mut talos_display);

    transfer::public_transfer(publisher, sender(ctx));
    transfer::public_transfer(talos_display, sender(ctx));
}

// ─── Public — Create ────────────────────────────────────────────────

/// Create a new Talos as a shared object and register it in the index.
///
/// Returns the assigned `talos_id` so the caller can persist it.
public fun create_talos(
    registry: &mut Registry,
    name: String,
    category: String,
    description: String,
    creator_share: u16,
    investor_share: u16,
    treasury_share: u16,
    investor_addr: address,
    treasury_addr: address,
    approval_threshold: u64,
    gtm_budget: u64,
    min_patron_pulse: u64,
    total_supply: u64,
    price_usd_micros: u64,
    token_symbol: String,
    walrus_profile_blob: vector<u8>,
    clock_ms: u64,
    ctx: &mut TxContext,
): u64 {
    assert!(
        (creator_share as u64) + (investor_share as u64) + (treasury_share as u64) == 10_000,
        EInvalidShares,
    );

    let creator_addr = sender(ctx);

    let patron = Patron {
        creator_share,
        investor_share,
        treasury_share,
        creator_addr,
        investor_addr,
        treasury_addr,
    };

    let kernel = Kernel {
        approval_threshold,
        gtm_budget,
        min_patron_pulse,
    };

    let mitos = Mitos {
        total_supply,
        price_usd_micros,
        token_symbol,
    };

    let talos_id = registry.next_talos_id;
    registry.next_talos_id = talos_id + 1;

    let talos = Talos {
        id: object::new(ctx),
        talos_id,
        name: name,
        category,
        description,
        creator: creator_addr,
        patron,
        kernel,
        mitos,
        walrus_profile_blob,
        walrus_activity_blobs: vector::empty(),
        created_at_ms: clock_ms,
        active: true,
    };

    let oid = object::id(&talos);
    table::add(&mut registry.talos_index, talos_id, oid);

    event::emit(TalosCreated {
        talos_id,
        object_id: oid,
        creator: creator_addr,
        name: talos.name,
    });

    transfer::share_object(talos);

    talos_id
}

// ─── Public — Mutations ─────────────────────────────────────────────

/// Update patron equity split. Only the original creator may call.
public fun update_patron(
    talos: &mut Talos,
    creator_share: u16,
    investor_share: u16,
    treasury_share: u16,
    investor_addr: address,
    treasury_addr: address,
    ctx: &TxContext,
) {
    assert!(sender(ctx) == talos.creator, EUnauthorized);
    assert!(talos.active, ETalosNotActive);
    assert!(
        (creator_share as u64) + (investor_share as u64) + (treasury_share as u64) == 10_000,
        EInvalidShares,
    );

    talos.patron = Patron {
        creator_share,
        investor_share,
        treasury_share,
        creator_addr: talos.creator,
        investor_addr,
        treasury_addr,
    };

    event::emit(PatronUpdated {
        talos_id: talos.talos_id,
        creator_share,
        investor_share,
        treasury_share,
    });
}

/// Update kernel governance policy. Only the creator may call.
public fun update_kernel(
    talos: &mut Talos,
    approval_threshold: u64,
    gtm_budget: u64,
    min_patron_pulse: u64,
    ctx: &TxContext,
) {
    assert!(sender(ctx) == talos.creator, EUnauthorized);
    assert!(talos.active, ETalosNotActive);
    talos.kernel = Kernel {
        approval_threshold,
        gtm_budget,
        min_patron_pulse,
    };
}

/// Update Mitos token metadata. Only the creator may call.
public fun update_mitos(
    talos: &mut Talos,
    total_supply: u64,
    price_usd_micros: u64,
    token_symbol: String,
    ctx: &TxContext,
) {
    assert!(sender(ctx) == talos.creator, EUnauthorized);
    assert!(talos.active, ETalosNotActive);
    talos.mitos = Mitos {
        total_supply,
        price_usd_micros,
        token_symbol,
    };
}

/// Update the Walrus profile blob (avatar + long description live off-chain).
public fun update_profile_blob(
    talos: &mut Talos,
    walrus_blob_id: vector<u8>,
    ctx: &TxContext,
) {
    assert!(sender(ctx) == talos.creator, EUnauthorized);
    talos.walrus_profile_blob = walrus_blob_id;
    event::emit(ProfileUpdated {
        talos_id: talos.talos_id,
        walrus_blob_id,
    });
}

/// Append a Walrus blob id holding a batch of agent activity logs.
///
/// Callable by the creator or by the protocol wallet (for the demo we keep
/// this open; production should verify via a registered agent capability).
public fun record_activity_batch(
    talos: &mut Talos,
    walrus_blob_id: vector<u8>,
    _ctx: &TxContext,
) {
    assert!(talos.active, ETalosNotActive);
    vector::push_back(&mut talos.walrus_activity_blobs, walrus_blob_id);
    event::emit(ActivityBatchRecorded {
        talos_id: talos.talos_id,
        walrus_blob_id,
    });
}

/// Deactivate the Talos (soft delete). Only creator.
public fun deactivate(talos: &mut Talos, ctx: &TxContext) {
    assert!(sender(ctx) == talos.creator, EUnauthorized);
    talos.active = false;
}

// ─── Public — Reads ─────────────────────────────────────────────────

public fun next_talos_id(registry: &Registry): u64 {
    registry.next_talos_id
}

public fun protocol_wallet(registry: &Registry): address {
    registry.protocol_wallet
}

public fun protocol_fee_bps(registry: &Registry): u16 {
    registry.protocol_fee_bps
}

public fun is_registered(registry: &Registry, talos_id: u64): bool {
    table::contains(&registry.talos_index, talos_id)
}

public fun talos_object_id(registry: &Registry, talos_id: u64): ID {
    *table::borrow(&registry.talos_index, talos_id)
}

public fun talos_id_of(talos: &Talos): u64 {
    talos.talos_id
}

public fun name_of(talos: &Talos): String {
    talos.name
}

public fun creator_of(talos: &Talos): address {
    talos.creator
}

public fun is_active(talos: &Talos): bool {
    talos.active
}

public fun patron_shares(talos: &Talos): (u16, u16, u16) {
    (
        talos.patron.creator_share,
        talos.patron.investor_share,
        talos.patron.treasury_share,
    )
}

public fun kernel_policy(talos: &Talos): (u64, u64, u64) {
    (
        talos.kernel.approval_threshold,
        talos.kernel.gtm_budget,
        talos.kernel.min_patron_pulse,
    )
}

public fun mitos_config(talos: &Talos): (u64, u64, String) {
    (
        talos.mitos.total_supply,
        talos.mitos.price_usd_micros,
        talos.mitos.token_symbol,
    )
}

public fun activity_blob_count(talos: &Talos): u64 {
    vector::length(&talos.walrus_activity_blobs)
}

public fun latest_activity_blob(talos: &Talos): vector<u8> {
    let n = vector::length(&talos.walrus_activity_blobs);
    if (n == 0) vector::empty() else *vector::borrow(&talos.walrus_activity_blobs, n - 1)
}

public fun profile_blob(talos: &Talos): vector<u8> {
    talos.walrus_profile_blob
}

// ─── Test Helpers ───────────────────────────────────────────────────

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(REGISTRY {}, ctx)
}
