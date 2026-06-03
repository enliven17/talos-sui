"""Sui tools — internal economy (Mitos tokens, SUI dividends, governance).

All operations are proxied through the Talos Web API or read from a
Tatum-backed Sui RPC endpoint. The Prime Agent never holds private keys.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from talos_agent.payments.sui_kit import SuiKit
from talos_agent.tools.registry import tool

if TYPE_CHECKING:
    from talos_agent.api_client import TalosAPIClient
    from talos_agent.config import Settings

# Injected by registry.build_all_tools
_settings: Settings = None  # type: ignore[assignment]
_api: TalosAPIClient = None  # type: ignore[assignment]
_sui_kit: SuiKit | None = None


def _get_kit() -> SuiKit:
    global _sui_kit
    if _sui_kit is None:
        _sui_kit = SuiKit(_api)
    return _sui_kit


@tool(
    "transfer_sui",
    "Transfer SUI to a Sui address (dividends, payments). Auto-checks approval threshold.",
)
async def transfer_sui(to_address: str, amount: float, reason: str = "") -> dict:
    kit = _get_kit()
    await kit.initialize()

    # Check threshold
    threshold = float(_settings.approval_threshold)
    if amount >= threshold:
        result = await _api.create_approval(
            _settings.talos_id,
            type_="transaction",
            title=f"SUI transfer: {amount} to {to_address}",
            description=reason,
            amount=amount,
        )
        return {
            "status": "approval_requested",
            "approval_id": result.get("id") if result else None,
            "amount": amount,
            "to": to_address,
        }

    return await kit.transfer_sui(to_address, amount)


@tool("get_sui_balance", "Check SUI balance for the Talos address via Tatum RPC")
async def get_sui_balance() -> dict:
    kit = _get_kit()
    await kit.initialize()
    return await kit.get_balance()


@tool(
    "create_mitos_token",
    "Request Mitos (equity) Coin<T> publication. Requires Creator approval on Dashboard.",
)
async def create_mitos_token(name: str, symbol: str, initial_supply: int = 1_000_000) -> dict:
    result = await _api.create_approval(
        _settings.talos_id,
        type_="transaction",
        title=f"Create Mitos token: {name} ({symbol})",
        description=(
            f"Initial supply: {initial_supply}. "
            "A Coin<T> Move module is published by Web and the TreasuryCap is held server-side."
        ),
    )
    return {
        "status": "approval_requested",
        "approval_id": result.get("id") if result else None,
        "action": "create_mitos_token",
        "name": name,
        "symbol": symbol,
    }


@tool(
    "airdrop_mitos",
    "Distribute Mitos tokens to Patron addresses. Requires Creator approval for large amounts.",
)
async def airdrop_mitos(coin_type: str, recipients: str) -> dict:
    """recipients: JSON string of [{address: '0x...', amount: 1000}, ...]"""
    import json as _json

    try:
        recipient_list = _json.loads(recipients) if isinstance(recipients, str) else recipients
    except _json.JSONDecodeError:
        return {"error": "recipients must be valid JSON: [{address: '0x...', amount: N}, ...]"}

    total_amount = sum(r.get("amount", 0) for r in recipient_list)
    threshold = float(_settings.approval_threshold)

    if total_amount >= threshold:
        result = await _api.create_approval(
            _settings.talos_id,
            type_="transaction",
            title=f"Mitos airdrop: type {coin_type}, total {total_amount}",
            description=f"Recipients: {recipients}",
            amount=total_amount,
        )
        return {
            "status": "approval_requested",
            "approval_id": result.get("id") if result else None,
            "action": "airdrop_mitos",
        }

    # Execute transfers via Web API
    results = []
    for r in recipient_list:
        addr = r.get("address", "")
        amt = r.get("amount", 0)
        if addr and amt > 0:
            res = await _api.request_transfer(
                to_account=addr, amount=amt, currency="MITOS", token_id=coin_type
            )
            results.append({"address": addr, "amount": amt, "result": res})
    return {"status": "completed", "transfers": results}


@tool(
    "execute_approved_transfer",
    "Execute a previously approved SUI or token transfer. Call after check_approval returns 'approved'.",
)
async def execute_approved_transfer(
    to_address: str,
    amount: float,
    currency: str = "SUI",
    coin_type: str = "",
) -> dict:
    result = await _api.request_transfer(
        to_account=to_address,
        amount=amount,
        currency=currency,
        token_id=coin_type or None,
    )
    if result and "error" not in result:
        return {"status": "completed", "to": to_address, "amount": amount, "result": result}
    return result or {"error": "Transfer execution failed"}


@tool(
    "get_mitos_balance",
    "Check Mitos token balance for a specific Sui address via Tatum RPC.",
)
async def get_mitos_balance(address: str, coin_type: str) -> dict:
    kit = _get_kit()
    await kit.initialize()
    return await kit.get_token_balance(address, coin_type)
