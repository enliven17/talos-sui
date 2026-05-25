// SPDX-License-Identifier: MIT
//
// Per-Talos Mitos Coin<T> template.
//
// One copy of this module is published per Talos at Genesis time:
//   1. `scripts/publish-mitos.ts` reads this file from disk
//   2. substitutes `TICKER` → the Talos's uppercased token symbol (e.g. NEXUS)
//   3. substitutes `Ticker Mitos` → "Nexus Mitos" (display name)
//   4. writes the substituted file to a tmp dir, runs `sui client publish`
//   5. captures the package id + TreasuryCap object id and writes the
//      coin type tag (`<pkg>::mitos::TICKER`) to the Talos's
//      `tls_talos.mitosCoinType` column.
//
// The TreasuryCap is transferred to the operator address so the web
// app can mint to buyers (the `/api/talos/:id/buy-token` route) and
// burn for buybacks. Patron governance (multi-sig) can take ownership
// of the cap later.
module mitos_TICKER::mitos;

use sui::coin::{Self, TreasuryCap};
use sui::url;

/// One-time witness — required by the Sui Coin framework to bind the
/// module-level `Coin<TICKER>` to this publisher.
public struct TICKER has drop {}

/// Initial mint amount transferred to the publisher (becomes the
/// operator treasury). Adjust per-talos via the publish script;
/// safer than hard-coding total supply.
const INITIAL_SUPPLY: u64 = 1_000_000;

/// Six decimals to match USDC ergonomics. Patrons usually quote
/// "1 MITOS = X USDC" so identical precision is friendlier in UIs.
const DECIMALS: u8 = 6;

fun init(witness: TICKER, ctx: &mut TxContext) {
    let (mut cap, metadata) = coin::create_currency<TICKER>(
        witness,
        DECIMALS,
        b"TICKER",
        b"Ticker Mitos",
        b"Per-Talos governance + revenue share token, issued via Talos Protocol on Sui.",
        option::some(url::new_unsafe_from_bytes(b"https://talos-sui.vercel.app/icon.svg")),
        ctx,
    );

    // Mint the initial supply to the publisher (operator address).
    let coin = coin::mint(&mut cap, INITIAL_SUPPLY, ctx);
    transfer::public_transfer(coin, tx_context::sender(ctx));

    // CoinMetadata is frozen so wallets / explorers can render symbol + name.
    transfer::public_freeze_object(metadata);

    // Hand the TreasuryCap to the publisher so they can mint/burn later.
    transfer::public_transfer(cap, tx_context::sender(ctx));
}

/// Operator-only mint, used by `/api/talos/:id/buy-token` after a USDC
/// payment is verified on-chain.
public fun mint(cap: &mut TreasuryCap<TICKER>, amount: u64, recipient: address, ctx: &mut TxContext) {
    let coin = coin::mint(cap, amount, ctx);
    transfer::public_transfer(coin, recipient);
}

/// Operator-only burn, used by treasury buyback flows.
public fun burn(cap: &mut TreasuryCap<TICKER>, coin: coin::Coin<TICKER>) {
    coin::burn(cap, coin);
}
