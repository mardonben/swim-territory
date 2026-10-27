# Sharked

Claim real-world map territory by completing swims.

## Running the app on your phone (Windows)

One-time setup on your PC:

1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Install **Git** from https://git-scm.com/download/win (accept the defaults).
3. Open **Command Prompt** and download the code:
   ```
   git clone https://github.com/mardonben/swim-territory.git
   cd swim-territory
   npm install
   ```
4. Add your Mapbox key so the map can load. Log in at https://account.mapbox.com, copy the **Default public token** (it starts with `pk.`), then in Command Prompt inside the `swim-territory` folder run this, pasting your token in place of `pk.YOUR_TOKEN`:
   ```
   echo EXPO_PUBLIC_MAPBOX_TOKEN=pk.YOUR_TOKEN> .env.local
   ```
   This file stays on your PC only and is never uploaded to GitHub. Public tokens are designed to live inside apps, but don't paste it into chats.

Each time you want to try the latest version:

1. In Command Prompt, inside the `swim-territory` folder:
   ```
   git pull
   npm install
   npx expo start
   ```
2. A QR code appears. Open **Expo Go** on your Android phone and scan it.
3. Your phone and PC need to be on the same Wi-Fi. If it won't connect, stop it with Ctrl+C and run `npx expo start --tunnel` instead.

## Using the map

- **Move and zoom** with two fingers. One finger never moves the map.
- **Draw** a loop with one finger and lift it. The app tidies it into the shape you meant (draw a rectangle, get a rectangle) with rounded corners. Roads don't matter: it's all about territory.
- **📍** (top left of the map) jumps back to where you are.
- **🏊 Pick a swim** lets you choose 25 m to 10 km. The app draws a circle from the middle of the map, sized so its boundary matches that swim.
- **🗑️ Clear** starts over.

Shapes always stop at land: they never go into the sea, and they follow coves and bays. Water completely surrounded by land, like a lake or pond, counts as part of the shape. Water that runs more than 2 km inland from its mouth (a river or estuary) is cut straight across its mouth, in line with the coast; shorter inlets like creeks are followed. The distance is a test setting (tap your nickname, then **🌊 Cut across the mouth of water that runs inland**). Water that runs off the edge of the screen counts as sea.

## Locking in a challenge (needs Supabase, one-time setup)

Once you have a shape, tap **🔒 Lock in this challenge**. It's saved online as your pending challenge and shows on the map as an orange dashed area, with a banner saying how far to swim. You can have one pending challenge at a time; tap **Cancel** on the banner to drop it.

The app is already connected to the Sharked Supabase project, and the database is set up with `supabase/001_challenges.sql`, `supabase/002_territory.sql`, `supabase/003_profiles.sql`, `supabase/004_area_details.sql` then `supabase/005_leaderboard.sql` (all safe to re-run). The one dashboard setting it needs is **Allow anonymous sign-ins**, under Authentication → Sign In / Providers.

## Claiming territory (test mode)

While a challenge is pending, **✅ I swam it (test)** pretends you've done the swim and claims the area. **The newest claim always wins:** wherever it overlaps older territory, yours or another swimmer's, that piece is cut out of the older area and becomes part of the new one. Each area shows in its holder's colour with their nickname on it, and the header counts the areas you hold. Once Strava is connected, a real watch-recorded swim will do this instead and the test button goes.

## Nicknames and colours

The first time you open the app it asks for a nickname and a map colour. Only these are shown to other swimmers: no real names, emails or phone details. Nicknames are unique (ignoring capitals) and can be 2 to 20 letters, numbers, spaces, - or _. Tap your nickname at the top to change it. Tap any area on the map to see who holds it, how long they've held it, and the swim that won it.

## Leaderboard

The **🏆 Leaderboard** tab ranks swimmers by the total outline of the land they hold right now, with their number of areas and area in km². Because the newest claim cuts into older land, a swimmer's total changes as soon as someone takes part of their territory. It is a separate page with no map; tap **🗺️ Map** at the top (or Android back) to return. Pull down to refresh.

## Pretend swimmers (testing)

Tap your nickname at the top to see who you're playing as. **➕ Add a pretend swimmer** creates another swimmer on the same phone (as many as you like), with its own nickname, colour and pending challenge. Switch between them from the same menu to draw areas as different people and watch them steal land from each other. Each pretend swimmer is a separate anonymous sign-in, kept on this phone only.

## Build plan

1. Blank app on the phone ✅
2. Map where you draw or pick a territory, showing the swim to claim it ✅
3. Save the shape as a pending challenge (Supabase) ✅
4. Colour the territory once a qualifying swim is done ✅ (test button for now)
5. Strava connection for real watch-recorded swims
