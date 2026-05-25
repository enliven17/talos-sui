// SPDX-License-Identifier: MIT
#[test_only]
module talos_registry::registry_tests;

use std::string;
use sui::test_scenario as ts;
use talos_registry::registry::{Self, Registry, Talos};

const CREATOR: address = @0xC0FFEE;
const INVESTOR: address = @0xBEEF;
const TREASURY: address = @0xCAFE;

#[test]
fun creates_talos_and_indexes_it() {
    let mut scenario = ts::begin(CREATOR);
    {
        registry::init_for_testing(scenario.ctx());
    };

    scenario.next_tx(CREATOR);
    {
        let mut reg = scenario.take_shared<Registry>();
        let id = registry::create_talos(
            &mut reg,
            string::utf8(b"Nexus"),
            string::utf8(b"Finance"),
            string::utf8(b"AI payments agent"),
            6000, // creator
            2500, // investor
            1500, // treasury
            INVESTOR,
            TREASURY,
            10_000_000, // approval threshold (10 USDC)
            200_000_000, // gtm budget
            100,
            1_000_000,
            500_000, // 0.5 USDC
            string::utf8(b"NEXUS"),
            b"walrus_profile_blob_id_placeholder",
            1_700_000_000_000,
            scenario.ctx(),
        );
        assert!(id == 1, 100);
        assert!(registry::next_talos_id(&reg) == 2, 101);
        assert!(registry::is_registered(&reg, 1), 102);
        ts::return_shared(reg);
    };

    scenario.next_tx(CREATOR);
    {
        let mut talos = scenario.take_shared<Talos>();
        assert!(registry::talos_id_of(&talos) == 1, 200);
        assert!(registry::creator_of(&talos) == CREATOR, 201);
        let (c, i, t) = registry::patron_shares(&talos);
        assert!(c == 6000 && i == 2500 && t == 1500, 202);
        registry::record_activity_batch(&mut talos, b"walrus_batch_001", scenario.ctx());
        assert!(registry::activity_blob_count(&talos) == 1, 203);
        ts::return_shared(talos);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = registry::EInvalidShares)]
fun rejects_invalid_share_split() {
    let mut scenario = ts::begin(CREATOR);
    {
        registry::init_for_testing(scenario.ctx());
    };
    scenario.next_tx(CREATOR);
    {
        let mut reg = scenario.take_shared<Registry>();
        // shares sum to 9999 (invalid)
        let _ = registry::create_talos(
            &mut reg,
            string::utf8(b"Bad"),
            string::utf8(b"X"),
            string::utf8(b""),
            5000, 3000, 1999,
            INVESTOR, TREASURY,
            0, 0, 0,
            1, 1,
            string::utf8(b"BAD"),
            b"",
            0,
            scenario.ctx(),
        );
        ts::return_shared(reg);
    };
    scenario.end();
}
