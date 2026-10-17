# Boom Blocks — Netlify Multiplayer

## Play solo

Click **Play Solo vs Computer** on the start screen. Enter your name first. The game starts locally without a room code, another device, or an internet connection. Choose and confirm your secret bomb; the computer selects its own bomb and takes turns automatically. Scores and the last-bomb match rule work the same way as multiplayer.

The game supports two connection modes. This package includes a Metered Realtime publishable key, so moves and room presence travel through a managed WebSocket service. Players on different networks only need the same room code. If the key is removed, the game uses Trystero peer-to-peer connections, which can fail on restrictive networks.

## Enable play across networks

1. Deploy `index.html`, `trystero.bundle.mjs`, `metered.bundle.mjs`, and `realtime-config.mjs` together.
2. Open the same HTTPS site on each device. One player creates a room; everyone else enters that room code and joins.

To rotate the key, create another **publishable** key in [the Metered dashboard](https://dashboard.metered.ca/) under **Realtime Messaging → Keys → Create key**. Allow `room-*` channels and enable **Subscribe**, **Publish**, **Presence**, and **Send**. Put the new key in `realtime-config.mjs` and redeploy. Never put a secret `sk_` key in that file. The connection key is configured in `realtime-config.mjs`; the game does not show a key field to players.

The publishable key is visible to visitors by design. Metered Realtime's account limits and availability apply. The game's state still lives in connected browsers; a room is not restored after everyone leaves.

## Deploy

Upload the four files listed above together to Netlify Drop, with all four at the site's top level. The game serves its libraries from your Netlify site instead of fetching them from a separate CDN at startup. Open the HTTPS URL on each device and refresh both pages after redeploying.

## Room setup

1. Enter your name, then choose **Play Solo vs Computer**, **Create Room**, or **Join Room**.
2. The creator chooses **2-8 participants**. The generated room code begins with that count (example: `4ABCDE`); changing the count generates a new code.
3. The creator clicks **Join Created Room** to go online, then copies and shares the code. Keep the creator's page open while others join.
4. Each other player enters a name, chooses **Join Room**, pastes the shared code, and clicks the Join Room button. Joiners do not choose a participant count.
5. The game waits for all selected participants to connect before bomb selection. The round begins after everyone confirms a bomb.
6. A code only works while its creator or another room member is online. If everyone leaves, create a new room and share its new code.

## Limits

The peer-to-peer fallback needs internet access and functioning third-party WebRTC peer discovery. Not all networks allow direct P2P connections. Managed rooms need a working Metered publishable key and connection to its WebSocket service. The game cannot restore old scores/state after every player leaves without online storage. If disconnected players return, a new setup may be needed. Multiplayer across actual devices still needs live testing.


## Live joined player list
The game screen now shows "Players in this room", the number joined out of the chosen room size, a progress bar, names of connected peers, and waiting slots. Each connected browser has to actually establish a peer connection to count. The roster does not use a central database. If every browser leaves, the old code remains empty; create a new room for a new match.

Each player has an individual score in the room roster. Extra people can connect to a full room as spectators; they do not replace active players between rounds. If an active player disconnects, the current round returns to bomb selection, clears used tiles, and gives an open place to a waiting spectator. Existing scores are kept. Each player locks one secret bomb. A bomb hit awards its owner 2 points (unless the picker hit their own bomb), reveals that bomb, and pauses for everyone to see the blast. Continue the match on the same board until one or fewer secret bombs remain. Safe picks award 1 point. The player with the highest score wins; tied highest scores share the win.

Run `node check.mjs` to check the game script and simulate two and three connected devices synchronizing their turns and scores. On Windows with Chrome installed, `node browser_check.mjs --local` tests two isolated browser contexts against the local files and public peer discovery.
