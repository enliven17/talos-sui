// SPDX-License-Identifier: MIT
//
// TalosNameService — Sui Move package for human-readable Talos names.
//
// Maps `name` → `talos_id` and reverse, with on-chain validation of
// length bounds (3..=32 bytes). Full character validation (lowercase
// alphanumeric + non-consecutive hyphens) is enforced off-chain by
// the Next.js layer; on-chain enforcement is kept minimal to save gas.
module talos_name_service::name_service;

use std::string::{Self, String};
use sui::event;
use sui::table::{Self, Table};

// ─── Errors ─────────────────────────────────────────────────────────

const ENameTooShort: u64 = 1;
const ENameTooLong: u64 = 2;
const ENameAlreadyTaken: u64 = 3;
const ENameNotFound: u64 = 4;
const ETalosAlreadyNamed: u64 = 5;

// ─── State ──────────────────────────────────────────────────────────

public struct Directory has key {
    id: UID,
    /// name -> talos_id
    forward: Table<String, u64>,
    /// talos_id -> name
    reverse: Table<u64, String>,
}

public struct NAME_SERVICE has drop {}

// ─── Events ─────────────────────────────────────────────────────────

public struct NameRegistered has copy, drop {
    talos_id: u64,
    name: String,
    owner: address,
}

// ─── Init ───────────────────────────────────────────────────────────

fun init(_otw: NAME_SERVICE, ctx: &mut TxContext) {
    let dir = Directory {
        id: object::new(ctx),
        forward: table::new(ctx),
        reverse: table::new(ctx),
    };
    transfer::share_object(dir);
}

// ─── Validation ─────────────────────────────────────────────────────

fun validate(name: &String) {
    let bytes = string::as_bytes(name);
    let len = vector::length(bytes);
    assert!(len >= 3, ENameTooShort);
    assert!(len <= 32, ENameTooLong);
}

// ─── Public — Mutations ─────────────────────────────────────────────

/// Register `name` for `talos_id`. Aborts if either side is already taken.
public fun register_name(
    dir: &mut Directory,
    talos_id: u64,
    name: String,
    ctx: &TxContext,
) {
    validate(&name);
    assert!(!table::contains(&dir.forward, name), ENameAlreadyTaken);
    assert!(!table::contains(&dir.reverse, talos_id), ETalosAlreadyNamed);

    table::add(&mut dir.forward, name, talos_id);
    table::add(&mut dir.reverse, talos_id, name);

    event::emit(NameRegistered {
        talos_id,
        name,
        owner: tx_context::sender(ctx),
    });
}

// ─── Public — Reads ─────────────────────────────────────────────────

public fun resolve_name(dir: &Directory, name: String): u64 {
    assert!(table::contains(&dir.forward, name), ENameNotFound);
    *table::borrow(&dir.forward, name)
}

public fun try_resolve_name(dir: &Directory, name: String): (bool, u64) {
    if (table::contains(&dir.forward, name)) {
        (true, *table::borrow(&dir.forward, name))
    } else {
        (false, 0)
    }
}

public fun name_of(dir: &Directory, talos_id: u64): String {
    assert!(table::contains(&dir.reverse, talos_id), ENameNotFound);
    *table::borrow(&dir.reverse, talos_id)
}

public fun has_name(dir: &Directory, talos_id: u64): bool {
    table::contains(&dir.reverse, talos_id)
}

public fun is_name_available(dir: &Directory, name: String): bool {
    let bytes = string::as_bytes(&name);
    let len = vector::length(bytes);
    if (len < 3 || len > 32) {
        return false
    };
    !table::contains(&dir.forward, name)
}

// ─── Test Helpers ───────────────────────────────────────────────────

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(NAME_SERVICE {}, ctx)
}
