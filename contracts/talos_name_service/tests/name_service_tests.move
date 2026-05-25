// SPDX-License-Identifier: MIT
#[test_only]
module talos_name_service::name_service_tests;

use std::string;
use sui::test_scenario as ts;
use talos_name_service::name_service::{Self, Directory};

const USER: address = @0xA11CE;

#[test]
fun registers_and_resolves() {
    let mut scenario = ts::begin(USER);
    {
        name_service::init_for_testing(scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        let mut dir = scenario.take_shared<Directory>();
        name_service::register_name(&mut dir, 1, string::utf8(b"nexus"), scenario.ctx());
        assert!(name_service::resolve_name(&dir, string::utf8(b"nexus")) == 1, 0);
        assert!(name_service::has_name(&dir, 1), 1);
        let (found, id) = name_service::try_resolve_name(&dir, string::utf8(b"nexus"));
        assert!(found && id == 1, 2);
        assert!(!name_service::is_name_available(&dir, string::utf8(b"nexus")), 3);
        assert!(name_service::is_name_available(&dir, string::utf8(b"vega")), 4);
        ts::return_shared(dir);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = name_service::ENameAlreadyTaken)]
fun rejects_duplicate_name() {
    let mut scenario = ts::begin(USER);
    {
        name_service::init_for_testing(scenario.ctx());
    };
    scenario.next_tx(USER);
    {
        let mut dir = scenario.take_shared<Directory>();
        name_service::register_name(&mut dir, 1, string::utf8(b"nexus"), scenario.ctx());
        name_service::register_name(&mut dir, 2, string::utf8(b"nexus"), scenario.ctx());
        ts::return_shared(dir);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = name_service::ENameTooShort)]
fun rejects_short_name() {
    let mut scenario = ts::begin(USER);
    {
        name_service::init_for_testing(scenario.ctx());
    };
    scenario.next_tx(USER);
    {
        let mut dir = scenario.take_shared<Directory>();
        name_service::register_name(&mut dir, 1, string::utf8(b"ab"), scenario.ctx());
        ts::return_shared(dir);
    };
    scenario.end();
}
