"""Sui operations — delegates to Web API.

The Prime Agent never holds Sui private keys. All on-chain operations
(balance queries, USDC transfers, dividends, Mitos transfers) go through
the Talos Web server, which uses the Sui TypeScript SDK server-side or
reads from a Tatum-backed RPC.
"""

from __future__ import annotations

import os
from typing import Any

from rich.console import Console

_DEFAULT_TATUM_RPC = "https://sui-testnet.gateway.tatum.io"
_SUI_RPC_URL = os.getenv("SUI_RPC_URL", _DEFAULT_TATUM_RPC)
_TATUM_API_KEY = os.getenv("TATUM_API_KEY", "")

console = Console()


class SuiKit:
    """Proxy for Sui operations via Talos Web API.

    Read operations call the Sui JSON-RPC directly (via Tatum gateway when an
    API key is configured). Write operations are forwarded to the Web app,
    which performs the signing using server-side Ed25519 keys.
    """

    def __init__(self, api_client: Any):
        self._api = api_client
        self._initialized = False

    async def initialize(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        console.print(
            f"[green]Sui proxy ready (RPC: {_SUI_RPC_URL}).[/green]"
        )

    @property
    def available(self) -> bool:
        return self._initialized

    async def _rpc(self, method: str, params: list[Any]) -> dict[str, Any]:
        """Call the configured Sui JSON-RPC endpoint."""
        import httpx

        headers = {"Content-Type": "application/json"}
        if _TATUM_API_KEY:
            headers["x-api-key"] = _TATUM_API_KEY

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                _SUI_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": method,
                    "params": params,
                },
                headers=headers,
            )
            r.raise_for_status()
            return r.json()

    async def get_balance(self, address: str = "") -> dict[str, Any]:
        """Return total SUI (in MIST) for the configured talos wallet."""
        try:
            talos = await self._api.get_talos(self._api._talos_id)
            addr = address or (talos.get("agentWalletAddress", "") if talos else "")
            if not addr:
                return {"error": "No Sui address configured"}
            data = await self._rpc("suix_getBalance", [addr])
            balance_mist = int(data.get("result", {}).get("totalBalance", "0"))
            return {
                "balance_sui": balance_mist / 1_000_000_000,
                "balance_mist": balance_mist,
                "account": addr,
            }
        except Exception as e:
            return {"error": f"Balance query failed: {e}"}

    async def get_token_balance(
        self, address: str, coin_type: str
    ) -> dict[str, Any]:
        """Return balance for an arbitrary Sui Coin type (e.g. USDC, MITOS)."""
        try:
            data = await self._rpc("suix_getBalance", [address, coin_type])
            total = int(data.get("result", {}).get("totalBalance", "0"))
            return {
                "balance": total,
                "coin_type": coin_type,
                "account": address,
            }
        except Exception as e:
            return {"error": f"Token balance query failed: {e}"}

    async def transfer_sui(self, to_address: str, amount: float) -> dict[str, Any]:
        """Request a SUI transfer via the Web API (which signs server-side)."""
        try:
            result = await self._api.request_transfer(
                to_account=to_address, amount=amount, currency="SUI"
            )
            if result:
                return {"status": "submitted", "to": to_address, "amount": amount}
            return {"error": "Transfer request failed"}
        except Exception as e:
            return {"error": f"Transfer failed: {e}"}
