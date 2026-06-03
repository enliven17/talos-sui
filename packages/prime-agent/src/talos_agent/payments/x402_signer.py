"""x402-on-Sui payment signer — delegates signing to Web's Sui proxy.

The Prime Agent never holds private keys. Signing is done by calling
POST /api/talos/:id/sign on the Talos Web server, which uses the
server-side Sui Ed25519 secret key to produce a USDC transfer on Sui
and returns the resulting transaction digest (the "payment token") that
the agent hands to the service provider as the `X-Payment` header value.
"""

from __future__ import annotations

from typing import Any

from rich.console import Console

console = Console()


class X402Signer:
    """Signs x402 payment authorizations via Web proxy (Sui).

    Instead of holding a private key locally, the agent calls the Web
    server's signing endpoint. Web authenticates via TALOS_API_KEY,
    verifies the amount against Kernel thresholds, and signs using
    the agent's Sui secret key stored server-side.
    """

    def __init__(self, api_client: Any):
        self._api = api_client
        self._wallet_id: str | None = None
        self._wallet_address: str | None = None
        self._initialized = False

    async def initialize(self) -> None:
        """Fetch agent wallet info from Web API."""
        if self._initialized:
            return
        try:
            wallet = await self._api.get_agent_wallet()
            if wallet and "walletId" in wallet:
                self._wallet_id = wallet["walletId"]
                self._wallet_address = wallet.get("publicKey") or wallet.get("address")
                self._initialized = True
                console.print(
                    f"[green]x402 signer ready (Sui): {self._wallet_address}[/green]"
                )
            else:
                console.print(
                    "[yellow]No agent wallet found. x402 signing disabled.[/yellow]"
                )
        except Exception as e:
            console.print(f"[yellow]x402 signer init failed: {e}[/yellow]")

    @property
    def available(self) -> bool:
        return self._initialized and self._wallet_address is not None

    @property
    def address(self) -> str | None:
        return self._wallet_address

    async def sign_payment(
        self,
        payee: str,
        amount: int | float | str,
        coin_type: str | None = None,
    ) -> dict[str, Any]:
        """Request an x402-on-Sui payment signature from Web's Sui proxy.

        Returns a dict containing the `payment_header` (the value of the
        `X-Payment` HTTP header) and the resulting Sui transaction digest.
        """
        if not self.available:
            return {"error": "x402 signer not initialized"}

        try:
            console.print(
                f"[dim]x402 sign (sui): payee={payee}, amount={amount}, coin={coin_type or 'USDC'}[/dim]"
            )
            result = await self._api.sign_payment(
                payee=payee,
                amount=amount,
                coin_type=coin_type,
            )

            if not result or "error" in result:
                err_detail = result.get("details", "") if result else ""
                return {
                    "error": f"{result.get('error', 'Signing request failed')} {err_detail}".strip()
                }

            return {
                "status": "signed",
                "payment_header": result["paymentHeader"],
                "from": result.get("from", self._wallet_address),
                "to": payee,
                "amount": amount,
                "tx_hash": result.get("txHash"),
            }
        except Exception as e:
            return {"error": f"Signing failed: {e}"}
