import { zkLoginStart } from "@/lib/zklogin";

/**
 * GET /api/zklogin/start
 *
 * Returns a fresh ephemeral keypair + nonce + max-epoch the client
 * should hand to Google/Twitch as the `nonce` query param when
 * starting an OAuth flow.
 *
 * The client must persist `randomness` + `ephemeralSecretKey` locally
 * (localStorage / sessionStorage) so it can finish the proof step after
 * the OAuth redirect.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ...zkLoginStart(),
    googleAuthBase: "https://accounts.google.com/o/oauth2/v2/auth",
    twitchAuthBase: "https://id.twitch.tv/oauth2/authorize",
    note:
      "Persist `randomness` + `ephemeralSecretKey` locally. After OAuth redirect, POST the resulting JWT to /api/zklogin/finish along with maxEpoch + randomness.",
  });
}
