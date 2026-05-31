// SPDX-License-Identifier: MIT
//
// Talos Badges — commemorative on-chain NFTs.
//
// Each badge proves participation in the Talos protocol. Three flavours:
//
//   - FounderBadge → minted to a Creator the moment they spin up a Talos.
//                    Includes the talos_id + the Walrus profile blob id.
//   - PatronBadge  → minted to a Patron the moment they cross the
//                    minimum Pulse holding threshold.
//   - ReviewerBadge → minted when a buyer publishes a review on Walrus.
//
// The minter cap is held by the protocol operator, so badges are minted
// server-side after a successful flow (or via Tatum's NFT API which
// delegates to this same module). The Display standard is registered
// for each badge so SuiVision / Suiet renders the image straight from
// Walrus.
module talos_badges::badges;

use std::string::{Self, String};
use sui::display;
use sui::event;
use sui::package;
use sui::tx_context::sender;

/// One-time witness used to claim Publisher.
public struct BADGES has drop {}

/// Operator capability — held by whoever publishes the package. Required
/// for every mint. Talos's operator address is the sole holder in prod;
/// can be wrapped behind multi-sig later.
public struct MinterCap has key, store { id: UID }

/// "I created Talos N at epoch X." Soulbound.
public struct FounderBadge has key {
    id: UID,
    talos_id: u64,
    creator: address,
    minted_at_ms: u64,
    walrus_profile_blob: String,
    name: String,
}

/// "I am a Patron of Talos N." Soulbound.
public struct PatronBadge has key {
    id: UID,
    talos_id: u64,
    patron: address,
    pulse_amount: u64,
    minted_at_ms: u64,
    name: String,
}

/// "I reviewed job J." Soulbound.
public struct ReviewerBadge has key {
    id: UID,
    job_id: String,
    reviewer: address,
    rating: u8,
    walrus_review_blob: String,
    minted_at_ms: u64,
}

public struct BadgeMinted has copy, drop {
    kind: u8, // 1 = founder, 2 = patron, 3 = reviewer
    recipient: address,
    badge_id: ID,
}

fun init(otw: BADGES, ctx: &mut TxContext) {
    let cap = MinterCap { id: object::new(ctx) };
    transfer::transfer(cap, sender(ctx));

    let publisher = package::claim(otw, ctx);

    // Display<FounderBadge>
    let mut founder_display = display::new<FounderBadge>(&publisher, ctx);
    display::add(
        &mut founder_display,
        string::utf8(b"name"),
        string::utf8(b"{name} — Talos #{talos_id}"),
    );
    display::add(
        &mut founder_display,
        string::utf8(b"description"),
        string::utf8(
            b"Founder badge minted for the Creator of Talos #{talos_id}. Soulbound.",
        ),
    );
    display::add(
        &mut founder_display,
        string::utf8(b"image_url"),
        string::utf8(
            b"https://aggregator.walrus-testnet.walrus.space/v1/blobs/{walrus_profile_blob}",
        ),
    );
    display::add(
        &mut founder_display,
        string::utf8(b"project_url"),
        string::utf8(b"https://talos-sui.vercel.app"),
    );
    display::update_version(&mut founder_display);

    // Display<PatronBadge>
    let mut patron_display = display::new<PatronBadge>(&publisher, ctx);
    display::add(
        &mut patron_display,
        string::utf8(b"name"),
        string::utf8(b"Patron — Talos #{talos_id}"),
    );
    display::add(
        &mut patron_display,
        string::utf8(b"description"),
        string::utf8(b"Holder of {pulse_amount} Pulse in Talos #{talos_id}."),
    );
    display::update_version(&mut patron_display);

    // Display<ReviewerBadge>
    let mut reviewer_display = display::new<ReviewerBadge>(&publisher, ctx);
    display::add(
        &mut reviewer_display,
        string::utf8(b"name"),
        string::utf8(b"Reviewer — Job {job_id}"),
    );
    display::add(
        &mut reviewer_display,
        string::utf8(b"description"),
        string::utf8(b"Rated {rating}/5. Walrus review: {walrus_review_blob}"),
    );
    display::update_version(&mut reviewer_display);

    transfer::public_transfer(publisher, sender(ctx));
    transfer::public_transfer(founder_display, sender(ctx));
    transfer::public_transfer(patron_display, sender(ctx));
    transfer::public_transfer(reviewer_display, sender(ctx));
}

/// Mint a FounderBadge — only the operator cap holder can call this.
public fun mint_founder(
    _cap: &MinterCap,
    talos_id: u64,
    creator: address,
    name: String,
    walrus_profile_blob: String,
    clock_ms: u64,
    ctx: &mut TxContext,
) {
    let badge = FounderBadge {
        id: object::new(ctx),
        talos_id,
        creator,
        minted_at_ms: clock_ms,
        walrus_profile_blob,
        name,
    };
    let badge_id = object::id(&badge);
    event::emit(BadgeMinted { kind: 1, recipient: creator, badge_id });
    transfer::transfer(badge, creator);
}

public fun mint_patron(
    _cap: &MinterCap,
    talos_id: u64,
    patron: address,
    pulse_amount: u64,
    name: String,
    clock_ms: u64,
    ctx: &mut TxContext,
) {
    let badge = PatronBadge {
        id: object::new(ctx),
        talos_id,
        patron,
        pulse_amount,
        minted_at_ms: clock_ms,
        name,
    };
    let badge_id = object::id(&badge);
    event::emit(BadgeMinted { kind: 2, recipient: patron, badge_id });
    transfer::transfer(badge, patron);
}

public fun mint_reviewer(
    _cap: &MinterCap,
    job_id: String,
    reviewer: address,
    rating: u8,
    walrus_review_blob: String,
    clock_ms: u64,
    ctx: &mut TxContext,
) {
    let badge = ReviewerBadge {
        id: object::new(ctx),
        job_id,
        reviewer,
        rating,
        walrus_review_blob,
        minted_at_ms: clock_ms,
    };
    let badge_id = object::id(&badge);
    event::emit(BadgeMinted { kind: 3, recipient: reviewer, badge_id });
    transfer::transfer(badge, reviewer);
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    let cap = MinterCap { id: object::new(ctx) };
    transfer::transfer(cap, sender(ctx));
}
